import Busboy from "busboy";

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import "dotenv/config";
import { z } from "zod";
import { evaluateSubmission } from "./services/ai";
import { prisma } from "./services/database";
import { recordSubmissionStreak } from "./services/streak";

import {
  AuthenticationError,
  AuthorizationError,
  requireAuthenticatedUser,
  requireRole,
} from "./services/auth";

import { transcribeAudio } from "./services/transcription/index.js";
import { UserRole } from "@prisma/client";

const port = Number(process.env.PORT ?? 4000);

const frontendUrl =
  process.env.FRONTEND_URL ?? "http://localhost:3000";

const resourceIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid MongoDB ObjectId");

const joinBodySchema = z.object({}).strict();

const submissionTypeMap = {
  text: "TEXT",
  code: "CODE",
  videoUrl: "VIDEO_URL",
  imageUrl: "IMAGE_URL",
  documentUrl: "DOCUMENT_URL",
} as const;

const submissionBodySchema = z
  .object({
    initiativeId: resourceIdSchema,
    taskId: resourceIdSchema,

    type: z.enum([
      "text",
      "code",
      "videoUrl",
      "imageUrl",
      "documentUrl",
    ]),

    content: z.string().trim().min(1).max(10_000),

    // Used for DSA submissions
    programmingLanguage: z
      .string()
      .trim()
      .max(50)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      ["videoUrl", "imageUrl", "documentUrl"].includes(
        value.type,
      ) &&
      !z.string().url().safeParse(value.content).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "URL submission types require a valid URL",
      });
    }

    // programmingLanguage is required for CODE submissions
    if (
      value.type === "code" &&
      (!value.programmingLanguage ||
        value.programmingLanguage.trim().length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "programmingLanguage is required for code submissions",
      });
    }
  });

const localEvaluationSchema = z.object({
  kind: z.literal("dsa"),
  content: z.string().trim().min(1).max(30_000),
  programmingLanguage: z.string().trim().min(1).max(50),
  taskDescription: z.string().trim().min(1).max(5_000),
});

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: object,
) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": frontendUrl,
    "Access-Control-Allow-Methods":
      "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",
    "Content-Type": "application/json",
  });

  response.end(JSON.stringify(body));
}

function getInitiativeId(
  pathname: string,
  pattern: RegExp,
) {
  const match = pathname.match(pattern);

  if (!match) {
    return null;
  }

  let id: string;

  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }

  const result =
    resourceIdSchema.safeParse(id);

  return result.success
    ? result.data
    : undefined;
}

async function readJson(
  request: IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(
      Buffer.concat(chunks).toString("utf8"),
    );
  } catch {
    return null;
  }
}

/*
 * Reads multipart/form-data requests.
 *
 * Used for English video uploads.
 */
async function readMultipart(
  request: IncomingMessage,
): Promise<{
  fields: Record<string, string>;
  file?: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  };
}> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};

    let file:
      | {
          buffer: Buffer;
          filename: string;
          mimeType: string;
        }
      | undefined;

    const busboy = Busboy({
      headers: request.headers,
      limits: {
        fileSize: 25 * 1024 * 1024,
        files: 1,
      },
    });

    busboy.on(
      "field",
      (name, value) => {
        fields[name] = value;
      },
    );

    busboy.on(
      "file",
      (_fieldname, stream, info) => {
        const chunks: Buffer[] = [];

        stream.on(
          "data",
          (chunk: Buffer) => {
            chunks.push(chunk);
          },
        );

        stream.on("limit", () => {
          reject(
            new Error(
              "Video file is too large. Maximum size is 25MB.",
            ),
          );
        });

        stream.on("end", () => {
          file = {
            buffer: Buffer.concat(chunks),
            filename: info.filename,
            mimeType: info.mimeType,
          };
        });
      },
    );

    busboy.on("finish", () => {
      resolve({
        fields,
        file,
      });
    });

    busboy.on("error", (error) => {
      reject(error);
    });

    request.pipe(busboy);
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method === "OPTIONS") {
    return sendJson(response, 204, {});
  }

  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  const { pathname } = url;

  /*
   * =========================================================
   * HEALTH CHECK
   * =========================================================
   */

  if (
    request.method === "GET" &&
    pathname === "/api/health"
  ) {
    return sendJson(response, 200, {
      success: true,
      message:
        "TaskMesh backend is running",
    });
  }

  if (request.method === "POST" && pathname === "/api/local/evaluate") {
    let hostname = "";
    try {
      hostname = new URL(`http://${request.headers.host ?? ""}`).hostname;
    } catch {
      return sendJson(response, 400, { success: false, error: "Invalid request host" });
    }
    const remoteAddress = request.socket.remoteAddress;
    const isLoopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
    if (process.env.NODE_ENV === "production" || !isLoopback || !["localhost", "127.0.0.1", "::1"].includes(hostname)) {
      return sendJson(response, 404, { success: false, error: "Not found" });
    }

    try {
      const contentType = request.headers["content-type"] ?? "";
      if (contentType.includes("multipart/form-data")) {
        const { fields, file } = await readMultipart(request);
        if (fields.kind !== "english" || !file) {
          return sendJson(response, 400, { success: false, error: "Choose an audio or video recording to submit" });
        }
        const supportedTypes = new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/webm", "audio/mpga", "audio/m4a", "audio/x-m4a", "audio/ogg", "audio/flac", "video/mp4", "video/webm", "video/quicktime"]);
        if (!supportedTypes.has(file.mimeType)) {
          return sendJson(response, 415, { success: false, error: "Use an MP3, MP4, M4A, WAV, or WebM recording" });
        }
        const transcript = await transcribeAudio(file.buffer, file.filename, file.mimeType);
        if (!transcript) return sendJson(response, 422, { success: false, error: "No speech could be detected in this recording" });
        const evaluation = await evaluateSubmission({
          initiative: { name: "English Initiative", evaluationRubric: null },
          taskDescription: fields.taskDescription ?? "Speak clearly and naturally about the assigned prompt.",
          submission: { type: "VIDEO_URL", content: transcript, transcript },
        });
        return sendJson(response, 200, { success: true, evaluation: { ...evaluation, transcript } });
      }

      const parsed = localEvaluationSchema.safeParse(await readJson(request));
      if (!parsed.success) return sendJson(response, 400, { success: false, error: "Enter a solution and programming language before submitting" });
      const evaluation = await evaluateSubmission({
        initiative: { name: "DSA Initiative", evaluationRubric: null },
        taskDescription: parsed.data.taskDescription,
        submission: { type: "CODE", content: parsed.data.content, programmingLanguage: parsed.data.programmingLanguage },
      });
      return sendJson(response, 200, { success: true, evaluation });
    } catch (error) {
      console.error("Local AI evaluation failed:", error);
      return sendJson(response, 503, { success: false, error: error instanceof Error ? error.message : "Evaluation could not be completed" });
    }
  }

  try {
    const currentUser =
      await requireAuthenticatedUser(request);

    /*
     * =========================================================
     * GET ALL INITIATIVES
     * =========================================================
     */

    if (
      request.method === "GET" &&
      pathname === "/api/initiatives"
    ) {
      const initiatives =
        await prisma.initiative.findMany({
          select: {
            id: true,
            name: true,
            description: true,
            submissionType: true,
            taskType: true,
            schedule: true,
          },
          orderBy: {
            name: "asc",
          },
        });

      return sendJson(response, 200, {
        success: true,
        data: initiatives,
      });
    }

    /*
     * =========================================================
     * ENGLISH VIDEO SUBMISSION
     * =========================================================
     *
     * POST:
     * /api/english/submissions/video
     *
     * multipart/form-data:
     * initiativeId
     * taskId
     * file
     */

    if (
      request.method === "POST" &&
      pathname ===
        "/api/english/submissions/video"
    ) {
      try {
        requireRole(
          currentUser,
          UserRole.STUDENT,
        );

        const {
          fields,
          file,
        } = await readMultipart(request);

        const initiativeId =
          fields.initiativeId;

        const taskId =
          fields.taskId;

        /*
         * Validate required fields
         */

        if (!initiativeId || !taskId) {
          return sendJson(response, 400, {
            success: false,
            message:
              "initiativeId and taskId are required",
          });
        }

        /*
         * Validate ObjectIds
         */

        const validInitiativeId =
          resourceIdSchema.safeParse(
            initiativeId,
          );

        const validTaskId =
          resourceIdSchema.safeParse(
            taskId,
          );

        if (
          !validInitiativeId.success ||
          !validTaskId.success
        ) {
          return sendJson(response, 400, {
            success: false,
            message:
              "Invalid initiativeId or taskId",
          });
        }

        /*
         * Check video exists
         */

        if (!file) {
          return sendJson(response, 400, {
            success: false,
            message:
              "Video file is required",
          });
        }

        /*
         * For the demo we support MP4 and WebM.
         */

        const allowedMimeTypes = [
          "video/mp4",
          "video/webm",
        ];

        if (
          !allowedMimeTypes.includes(
            file.mimeType,
          )
        ) {
          return sendJson(response, 400, {
            success: false,
            message:
              "Only MP4 and WebM videos are supported",
          });
        }

        /*
         * Find task
         */

        const task =
          await prisma.task.findFirst({
            where: {
              id: validTaskId.data,
              initiativeId:
                validInitiativeId.data,
            },
            include: {
              initiative: true,
            },
          });

        if (!task) {
          return sendJson(response, 404, {
            success: false,
            message:
              "Task not found for initiative",
          });
        }

        /*
         * Check membership
         */

        const membership =
          await prisma.initiativeMember.findUnique(
            {
              where: {
                userId_initiativeId: {
                  userId:
                    currentUser.id,
                  initiativeId:
                    validInitiativeId.data,
                },
              },
            },
          );

        if (!membership) {
          return sendJson(response, 403, {
            success: false,
            message:
              "Join this initiative before submitting",
          });
        }

        /*
         * Prevent duplicate submission
         */

        const existing =
          await prisma.submission.findUnique({
            where: {
              taskId_userId: {
                taskId: task.id,
                userId:
                  currentUser.id,
              },
            },
          });

        if (existing) {
          return sendJson(response, 409, {
            success: false,
            message:
              "Submission already exists for this task",
            submissionId:
              existing.id,
          });
        }

        /*
         * Transcribe video
         */

        console.log(
          `Transcribing English video: ${file.filename}`,
        );

        const transcript =
          await transcribeAudio(
            file.buffer,
            file.filename,
            file.mimeType,
          );

        if (!transcript) {
          return sendJson(response, 400, {
            success: false,
            message:
              "Could not extract speech from the video",
          });
        }

        /*
         * Save submission
         *
         * We store the transcript in:
         * - content
         * - transcript
         *
         * The actual video is NOT permanently stored yet.
         */

        const submission =
          await prisma.$transaction(
            async (transaction) => {
              const createdSubmission =
                await transaction.submission.create(
                  {
                    data: {
                      taskId: task.id,
                      userId:
                        currentUser.id,
                      type: "VIDEO_URL",
                      content:
                        transcript,
                      transcript:
                        transcript,
                      status:
                        "PENDING",
                    },

                    select: {
                      id: true,
                      taskId: true,
                      userId: true,
                      type: true,
                      content: true,
                      transcript: true,
                      mediaUrl: true,
                      status: true,
                      createdAt: true,
                    },
                  },
                );

              await recordSubmissionStreak(
                transaction,
                {
                  ...createdSubmission,
                  initiativeId:
                    validInitiativeId.data,
                },
              );

              return createdSubmission;
            },
          );

        return sendJson(response, 201, {
          success: true,
          message:
            "Video uploaded and transcribed successfully",
          data: submission,
        });
      } catch (error) {
        console.error(
          "English video submission error:",
          error,
        );

        return sendJson(response, 500, {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Failed to process English video",
        });
      }
    }

    /*
     * =========================================================
     * NORMAL SUBMISSION
     * =========================================================
     *
     * This handles:
     * - TEXT
     * - CODE / DSA
     * - VIDEO URL
     * - IMAGE URL
     * - DOCUMENT URL
     *
     * DSA uses:
     * type = "code"
     * programmingLanguage = "Java"
     */

    if (
      request.method === "POST" &&
      pathname === "/api/submissions"
    ) {
      const body =
        submissionBodySchema.safeParse(
          await readJson(request),
        );

      if (!body.success) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid submission request",
          errors: body.error.issues,
        });
      }

      requireRole(
        currentUser,
        UserRole.STUDENT,
      );

      const task =
        await prisma.task.findFirst({
          where: {
            id: body.data.taskId,
            initiativeId:
              body.data.initiativeId,
          },
        });

      if (!task) {
        return sendJson(response, 404, {
          success: false,
          message:
            "Task not found for initiative",
        });
      }

      const membership =
        await prisma.initiativeMember.findUnique(
          {
            where: {
              userId_initiativeId: {
                userId:
                  currentUser.id,
                initiativeId:
                  body.data.initiativeId,
              },
            },
          },
        );

      if (!membership) {
        return sendJson(response, 403, {
          success: false,
          message:
            "Join this initiative before submitting",
        });
      }

      const existing =
        await prisma.submission.findUnique({
          where: {
            taskId_userId: {
              taskId: task.id,
              userId:
                currentUser.id,
            },
          },
        });

      if (existing) {
        return sendJson(response, 409, {
          success: false,
          message:
            "Submission already exists for this task",
          submissionId:
            existing.id,
        });
      }

      const isUrlSubmission = [
        "videoUrl",
        "imageUrl",
        "documentUrl",
      ].includes(body.data.type);

      const submission =
        await prisma.$transaction(
          async (transaction) => {
            const createdSubmission =
              await transaction.submission.create(
                {
                  data: {
                    taskId: task.id,

                    userId:
                      currentUser.id,

                    type:
                      submissionTypeMap[
                        body.data.type
                      ],

                    content:
                      body.data.content,

                    /*
                     * DSA language
                     *
                     * Example:
                     * Java
                     * C++
                     * Python
                     */

                    programmingLanguage:
                      body.data
                        .programmingLanguage ??
                      null,

                    mediaUrl:
                      isUrlSubmission
                        ? body.data
                            .content
                        : null,
                  },

                  select: {
                    id: true,
                    taskId: true,
                    userId: true,
                    type: true,
                    content: true,
                    programmingLanguage:
                      true,
                    mediaUrl: true,
                    status: true,
                    createdAt: true,
                  },
                },
              );

            await recordSubmissionStreak(
              transaction,
              {
                ...createdSubmission,
                initiativeId:
                  body.data
                    .initiativeId,
              },
            );

            return createdSubmission;
          },
        );

      return sendJson(response, 201, {
        success: true,
        data: submission,
      });
    }

    /*
     * =========================================================
     * GET SUBMISSION
     * =========================================================
     */

    const submissionId =
      getInitiativeId(
        pathname,
        /^\/api\/submissions\/([^/]+)$/,
      );

    if (
      request.method === "GET" &&
      submissionId !== null
    ) {
      if (submissionId === undefined) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid submission id",
        });
      }

      const submission =
        await prisma.submission.findUnique({
          where: {
            id: submissionId,
          },

          select: {
            id: true,
            taskId: true,
            userId: true,
            type: true,
            content: true,
            transcript: true,
            programmingLanguage:
              true,
            mediaUrl: true,
            status: true,
            createdAt: true,
            updatedAt: true,

            task: {
              select: {
                initiativeId: true,
                title: true,
              },
            },
          },
        });

      if (
        submission &&
        submission.userId !==
          currentUser.id
      ) {
        return sendJson(response, 403, {
          success: false,
          message:
            "You cannot view another user's submission",
        });
      }

      return submission
        ? sendJson(response, 200, {
            success: true,
            data: submission,
          })
        : sendJson(response, 404, {
            success: false,
            message:
              "Submission not found",
          });
    }

    /*
     * =========================================================
     * EVALUATE SUBMISSION
     * =========================================================
     */

    const evaluateSubmissionId =
      getInitiativeId(
        pathname,
        /^\/api\/submissions\/([^/]+)\/evaluate$/,
      );

    if (
      request.method === "POST" &&
      evaluateSubmissionId !== null
    ) {
      if (
        evaluateSubmissionId ===
        undefined
      ) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid submission id",
        });
      }

      const submission =
        await prisma.submission.findUnique({
          where: {
            id: evaluateSubmissionId,
          },

          select: {
            id: true,
            content: true,
            transcript: true,
            programmingLanguage:
              true,
            type: true,
            userId: true,

            task: {
              select: {
                initiative: {
                  select: {
                    name: true,
                    evaluationRubric:
                      true,
                  },
                },
              },
            },
          },
        });

      if (!submission) {
        return sendJson(response, 404, {
          success: false,
          message:
            "Submission not found",
        });
      }

      if (
        submission.userId !==
        currentUser.id
      ) {
        return sendJson(response, 403, {
          success: false,
          message:
            "You cannot evaluate another user's submission",
        });
      }

      const result =
        await evaluateSubmission({
          initiative:
            submission.task
              .initiative,

          submission,
        });

      const evaluation =
        await prisma.$transaction(
          async (transaction) => {
            const savedEvaluation =
              await transaction.evaluation.upsert(
                {
                  where: {
                    submissionId:
                      submission.id,
                  },

                  update: result,

                  create: {
                    submissionId:
                      submission.id,
                    ...result,
                  },

                  select: {
                    id: true,
                    submissionId:
                      true,
                    score: true,
                    strengths:
                      true,
                    weaknesses:
                      true,
                    feedback:
                      true,
                    improvements:
                      true,
                    source: true,
                    createdAt:
                      true,
                    updatedAt:
                      true,
                  },
                },
              );

            await transaction.submission.update(
              {
                where: {
                  id: submission.id,
                },

                data: {
                  status:
                    "EVALUATED",
                },
              },
            );

            return savedEvaluation;
          },
        );

      return sendJson(response, 200, {
        success: true,
        data: evaluation,
      });
    }

    /*
     * =========================================================
     * GET EVALUATION
     * =========================================================
     */

    const evaluationSubmissionId =
      getInitiativeId(
        pathname,
        /^\/api\/submissions\/([^/]+)\/evaluation$/,
      );

    if (
      request.method === "GET" &&
      evaluationSubmissionId !== null
    ) {
      if (
        evaluationSubmissionId ===
        undefined
      ) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid submission id",
        });
      }

      const submission =
        await prisma.submission.findUnique({
          where: {
            id: evaluationSubmissionId,
          },

          select: {
            id: true,
            userId: true,

            evaluation: {
              select: {
                id: true,
                submissionId:
                  true,
                score: true,
                strengths: true,
                weaknesses:
                  true,
                feedback: true,
                improvements:
                  true,
                source: true,
                createdAt:
                  true,
                updatedAt:
                  true,
              },
            },
          },
        });

      if (!submission) {
        return sendJson(response, 404, {
          success: false,
          message:
            "Submission not found",
        });
      }

      if (
        submission.userId !==
        currentUser.id
      ) {
        return sendJson(response, 403, {
          success: false,
          message:
            "You cannot view another user's evaluation",
        });
      }

      return submission.evaluation
        ? sendJson(response, 200, {
            success: true,
            data:
              submission.evaluation,
          })
        : sendJson(response, 404, {
            success: false,
            message:
              "Evaluation not found",
          });
    }

    /*
     * =========================================================
     * GET INITIATIVE
     * =========================================================
     */

    const initiativeId =
      getInitiativeId(
        pathname,
        /^\/api\/initiatives\/([^/]+)$/,
      );

    if (
      request.method === "GET" &&
      initiativeId !== null
    ) {
      if (initiativeId === undefined) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid initiative id",
        });
      }

      const initiative =
        await prisma.initiative.findUnique(
          {
            where: {
              id: initiativeId,
            },

            select: {
              id: true,
              name: true,
              description: true,
              submissionType: true,
              taskType: true,
              evaluationRubric:
                true,
              scoringRules: true,
              schedule: true,
              rules: true,
            },
          },
        );

      return initiative
        ? sendJson(response, 200, {
            success: true,
            data: initiative,
          })
        : sendJson(response, 404, {
            success: false,
            message:
              "Initiative not found",
          });
    }

    /*
     * =========================================================
     * INITIATIVE STATS
     * =========================================================
     */

    const statsInitiativeId =
      getInitiativeId(
        pathname,
        /^\/api\/initiatives\/([^/]+)\/stats$/,
      );

    if (
      request.method === "GET" &&
      statsInitiativeId !== null
    ) {
      if (
        statsInitiativeId ===
        undefined
      ) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid initiative id",
        });
      }

      const initiative =
        await prisma.initiative.findUnique({
          where: {
            id: statsInitiativeId,
          },

          select: {
            id: true,
          },
        });

      if (!initiative) {
        return sendJson(response, 404, {
          success: false,
          message:
            "Initiative not found",
        });
      }

      const activeSince =
        new Date();

      activeSince.setDate(
        activeSince.getDate() - 7,
      );

      const [
        members,
        taskCount,
        submissions,
        evaluationAverage,
      ] = await Promise.all([
        prisma.initiativeMember.findMany(
          {
            where: {
              initiativeId:
                initiative.id,
              role: "MEMBER",
            },

            select: {
              userId: true,
            },
          },
        ),

        prisma.task.count({
          where: {
            initiativeId:
              initiative.id,
          },
        }),

        prisma.submission.findMany({
          where: {
            task: {
              initiativeId:
                initiative.id,
            },
          },

          select: {
            userId: true,
            createdAt: true,
          },
        }),

        prisma.evaluation.aggregate({
          where: {
            submission: {
              task: {
                initiativeId:
                  initiative.id,
              },
            },
          },

          _avg: {
            score: true,
          },
        }),
      ]);

      const memberIds =
        new Set(
          members.map(
            (member) =>
              member.userId,
          ),
        );

      const memberSubmissions =
        submissions.filter(
          (submission) =>
            memberIds.has(
              submission.userId,
            ),
        );

      const activeMembers =
        new Set(
          memberSubmissions
            .filter(
              (submission) =>
                submission.createdAt >=
                activeSince,
            )
            .map(
              (submission) =>
                submission.userId,
            ),
        ).size;

      const completionPercentage =
        members.length &&
        taskCount
          ? Math.round(
              (memberSubmissions.length /
                (members.length *
                  taskCount)) *
                10000,
            ) / 100
          : 0;

      return sendJson(response, 200, {
        success: true,
        data: {
          totalMembers:
            members.length,

          submissions:
            memberSubmissions.length,

          averageScore:
            Math.round(
              (evaluationAverage
                ._avg.score ?? 0) *
                100,
            ) / 100,

          completionPercentage,

          activeMembers,
        },
      });
    }

    /*
     * =========================================================
     * LEADERBOARD
     * =========================================================
     */

    const leaderboardInitiativeId =
      getInitiativeId(
        pathname,
        /^\/api\/initiatives\/([^/]+)\/leaderboard$/,
      );

    if (
      request.method === "GET" &&
      leaderboardInitiativeId !==
        null
    ) {
      if (
        leaderboardInitiativeId ===
        undefined
      ) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid initiative id",
        });
      }

      const initiative =
        await prisma.initiative.findUnique({
          where: {
            id: leaderboardInitiativeId,
          },

          select: {
            id: true,
          },
        });

      if (!initiative) {
        return sendJson(response, 404, {
          success: false,
          message:
            "Initiative not found",
        });
      }

      const [
        members,
        submissions,
        streaks,
      ] = await Promise.all([
        prisma.initiativeMember.findMany(
          {
            where: {
              initiativeId:
                initiative.id,
              role: "MEMBER",
            },

            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        ),

        prisma.submission.findMany({
          where: {
            task: {
              initiativeId:
                initiative.id,
            },
          },

          select: {
            userId: true,

            evaluation: {
              select: {
                score: true,
              },
            },
          },
        }),

        prisma.streak.findMany({
          where: {
            initiativeId:
              initiative.id,
          },

          select: {
            userId: true,
            currentCount: true,
          },
        }),
      ]);

      const scoreByUser =
        new Map<string, number[]>();

      for (const submission of submissions) {
        if (
          submission.evaluation?.score !==
            null &&
          submission.evaluation?.score !==
            undefined
        ) {
          scoreByUser.set(
            submission.userId,
            [
              ...(scoreByUser.get(
                submission.userId,
              ) ?? []),

              submission.evaluation
                .score,
            ],
          );
        }
      }

      const streakByUser =
        new Map(
          streaks.map(
            (streak) => [
              streak.userId,
              streak.currentCount,
            ],
          ),
        );

      const entries = members
        .map(({ user }) => {
          const scores =
            scoreByUser.get(
              user.id,
            ) ?? [];

          const points =
            scores.reduce(
              (total, score) =>
                total + score,
              0,
            );

          return {
            student: {
              id: user.id,
              name: user.name,
              email: user.email,
            },

            points,

            streak:
              streakByUser.get(
                user.id,
              ) ?? 0,

            averageScore:
              scores.length
                ? Math.round(
                    (points /
                      scores.length) *
                      100,
                  ) / 100
                : 0,
          };
        })
        .sort(
          (left, right) =>
            right.points -
              left.points ||
            right.averageScore -
              left.averageScore ||
            (
              left.student.name ??
              left.student.email
            ).localeCompare(
              right.student.name ??
                right.student.email,
            ),
        );

      return sendJson(response, 200, {
        success: true,

        data: entries.map(
          (entry, index) => ({
            rank: index + 1,
            ...entry,
          }),
        ),
      });
    }

    /*
     * =========================================================
     * INITIATIVE REPORT
     * =========================================================
     */

    const reportInitiativeId =
      getInitiativeId(
        pathname,
        /^\/api\/initiatives\/([^/]+)\/report$/,
      );

    if (
      request.method === "GET" &&
      reportInitiativeId !== null
    ) {
      if (
        reportInitiativeId ===
        undefined
      ) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid initiative id",
        });
      }

      const initiative =
        await prisma.initiative.findUnique(
          {
            where: {
              id: reportInitiativeId,
            },

            select: {
              id: true,
              name: true,
            },
          },
        );

      if (!initiative) {
        return sendJson(response, 404, {
          success: false,
          message:
            "Initiative not found",
        });
      }

      const activeSince =
        new Date();

      activeSince.setDate(
        activeSince.getDate() - 7,
      );

      const [
        taskCount,
        members,
        submissions,
        streaks,
      ] = await Promise.all([
        prisma.task.count({
          where: {
            initiativeId:
              initiative.id,
          },
        }),

        prisma.initiativeMember.findMany(
          {
            where: {
              initiativeId:
                initiative.id,
              role: "MEMBER",
            },

            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        ),

        prisma.submission.findMany({
          where: {
            task: {
              initiativeId:
                initiative.id,
            },
          },

          select: {
            userId: true,
            createdAt: true,

            evaluation: {
              select: {
                score: true,
                weaknesses: true,
                createdAt: true,
              },
            },
          },

          orderBy: {
            createdAt: "asc",
          },
        }),

        prisma.streak.findMany({
          where: {
            initiativeId:
              initiative.id,
          },

          select: {
            userId: true,
            currentCount: true,
          },
        }),
      ]);

      const streakByUser =
        new Map(
          streaks.map(
            (streak) => [
              streak.userId,
              streak.currentCount,
            ],
          ),
        );

      const submissionsByUser =
        new Map<
          string,
          typeof submissions
        >();

      const weaknessCounts =
        new Map<string, number>();

      for (const submission of submissions) {
        submissionsByUser.set(
          submission.userId,
          [
            ...(submissionsByUser.get(
              submission.userId,
            ) ?? []),

            submission,
          ],
        );

        if (
          Array.isArray(
            submission.evaluation
              ?.weaknesses,
          )
        ) {
          for (const weakness of
            submission.evaluation
              .weaknesses) {
            if (
              typeof weakness ===
              "string"
            ) {
              weaknessCounts.set(
                weakness,
                (weaknessCounts.get(
                  weakness,
                ) ?? 0) + 1,
              );
            }
          }
        }
      }

      const students =
        members.map(
          ({ user }) => {
            const studentSubmissions =
              submissionsByUser.get(
                user.id,
              ) ?? [];

            const scores =
              studentSubmissions.flatMap(
                (submission) =>
                  submission
                    .evaluation
                    ?.score == null
                    ? []
                    : [
                        submission
                          .evaluation
                          .score,
                      ],
              );

            const averageScore =
              scores.length
                ? Math.round(
                    (scores.reduce(
                      (
                        total,
                        score,
                      ) =>
                        total + score,
                      0,
                    ) /
                      scores.length) *
                      100,
                  ) / 100
                : 0;

            const improvement =
              scores.length >= 2
                ? scores[
                    scores.length - 1
                  ] - scores[0]
                : null;

            return {
              student: user,

              submissions:
                studentSubmissions.length,

              averageScore,

              streak:
                streakByUser.get(
                  user.id,
                ) ?? 0,

              improvement,
            };
          },
        );

      const activeMembers =
        students.filter(
          (student) =>
            (
              submissionsByUser.get(
                student.student.id,
              ) ?? []
            ).some(
              (submission) =>
                submission.createdAt >=
                activeSince,
            ),
        ).length;

      const completionRate =
        students.length &&
        taskCount
          ? Math.round(
              (submissions.length /
                (students.length *
                  taskCount)) *
                10000,
            ) / 100
          : 0;

      const evaluationScores =
        submissions.flatMap(
          (submission) =>
            submission.evaluation
              ?.score == null
              ? []
              : [
                  submission
                    .evaluation
                    .score,
                ],
        );

      const roundAverageScore =
        evaluationScores.length
          ? Math.round(
              (evaluationScores.reduce(
                (
                  total,
                  score,
                ) =>
                  total + score,
                0,
              ) /
                evaluationScores.length) *
                100,
            ) / 100
          : 0;

      const presenter = (
        student: (typeof students)[number],
      ) => ({
        student:
          student.student,

        averageScore:
          student.averageScore,

        submissions:
          student.submissions,

        streak:
          student.streak,

        improvement:
          student.improvement,
      });

      return sendJson(response, 200, {
        success: true,

        data: {
          initiative: {
            id: initiative.id,
            name: initiative.name,
          },

          totalMembers:
            students.length,

          activeMembers,

          completionRate,

          averageScore:
            roundAverageScore,

          topPerformers: [
            ...students,
          ]
            .filter(
              (student) =>
                student.submissions >
                0,
            )
            .sort(
              (a, b) =>
                b.averageScore -
                a.averageScore,
            )
            .slice(0, 3)
            .map(presenter),

          mostConsistentStudents: [
            ...students,
          ]
            .filter(
              (student) =>
                student.streak > 0,
            )
            .sort(
              (a, b) =>
                b.streak -
                a.streak,
            )
            .slice(0, 3)
            .map(presenter),

          mostImprovedStudents: [
            ...students,
          ]
            .filter(
              (student) =>
                student.improvement !==
                null,
            )
            .sort(
              (a, b) =>
                (b.improvement ??
                  0) -
                (a.improvement ??
                  0),
            )
            .slice(0, 3)
            .map(presenter),

          studentsNeedingAttention:
            students
              .filter(
                (student) =>
                  student.submissions ===
                    0 ||
                  student.averageScore <
                    70,
              )
              .map(presenter),

          commonWeaknesses: [
            ...weaknessCounts.entries(),
          ]
            .sort(
              (a, b) =>
                b[1] - a[1],
            )
            .slice(0, 5)
            .map(
              ([weakness, count]) => ({
                weakness,
                count,
              }),
            ),
        },
      });
    }

    /*
     * =========================================================
     * JOIN INITIATIVE
     * =========================================================
     */

    const joinId =
      getInitiativeId(
        pathname,
        /^\/api\/initiatives\/([^/]+)\/join$/,
      );

    if (
      request.method === "POST" &&
      joinId !== null
    ) {
      if (joinId === undefined) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid initiative id",
        });
      }

      const body =
        joinBodySchema.safeParse(
          await readJson(request),
        );

      if (!body.success) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid join request",
        });
      }

      requireRole(
        currentUser,
        UserRole.STUDENT,
      );

      const initiative =
        await prisma.initiative.findUnique(
          {
            where: {
              id: joinId,
            },

            select: {
              id: true,
              name: true,
            },
          },
        );

      if (!initiative) {
        return sendJson(response, 404, {
          success: false,
          message:
            "Initiative not found",
        });
      }

      const membership =
        await prisma.initiativeMember.upsert(
          {
            where: {
              userId_initiativeId: {
                userId:
                  currentUser.id,

                initiativeId:
                  initiative.id,
              },
            },

            update: {},

            create: {
              userId:
                currentUser.id,

              initiativeId:
                initiative.id,
            },
          },
        );

      return sendJson(response, 200, {
        success: true,

        data: {
          initiative,
          membership,
        },
      });
    }

    /*
     * =========================================================
     * TODAY'S TASK
     * =========================================================
     */

    const taskId =
      getInitiativeId(
        pathname,
        /^\/api\/initiatives\/([^/]+)\/tasks\/today$/,
      );

    if (
      request.method === "GET" &&
      taskId !== null
    ) {
      if (taskId === undefined) {
        return sendJson(response, 400, {
          success: false,
          message:
            "Invalid initiative id",
        });
      }

      const initiative =
        await prisma.initiative.findUnique(
          {
            where: {
              id: taskId,
            },

            select: {
              id: true,
            },
          },
        );

      if (!initiative) {
        return sendJson(response, 404, {
          success: false,
          message:
            "Initiative not found",
        });
      }

      const startOfToday =
        new Date();

      startOfToday.setHours(
        0,
        0,
        0,
        0,
      );

      const startOfTomorrow =
        new Date(startOfToday);

      startOfTomorrow.setDate(
        startOfTomorrow.getDate() + 1,
      );

      const task =
        await prisma.task.findFirst({
          where: {
            initiativeId: taskId,

            dueAt: {
              gte: startOfToday,
              lt: startOfTomorrow,
            },
          },

          select: {
            id: true,
            title: true,
            description: true,
            dueAt: true,
          },

          orderBy: {
            dueAt: "asc",
          },
        });

      return task
        ? sendJson(response, 200, {
            success: true,
            data: task,
          })
        : sendJson(response, 404, {
            success: false,
            message:
              "No task scheduled for today",
          });
    }
  } catch (error) {
    if (
      error instanceof
      AuthenticationError
    ) {
      return sendJson(response, 401, {
        success: false,
        message: error.message,
      });
    }

    if (
      error instanceof
      AuthorizationError
    ) {
      return sendJson(response, 403, {
        success: false,
        message: error.message,
      });
    }

    console.error(
      "API request failed",
      error,
    );

    return sendJson(response, 500, {
      success: false,
      message:
        "Database request failed",
    });
  }

  return sendJson(response, 404, {
    success: false,
    message: "Route not found",
  });
}

const server = createServer(handleRequest);
const onListening = () => console.log(`TaskMesh backend listening on http://localhost:${port}`);
if (process.env.NODE_ENV === "production") server.listen(port, onListening);
else server.listen(port, "127.0.0.1", onListening);