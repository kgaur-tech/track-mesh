import { spawn } from "node:child_process";
import { resolve } from "node:path";

export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  _mimeType: string,
): Promise<string> {
  const script = resolve(process.cwd(), "src", "services", "transcription", "transcribe.py");
  const python = process.env.WHISPER_PYTHON ?? "py";
  const pythonArgs = python === "py" ? ["-3.14", script, filename] : [script, filename];
  const child = spawn(python, pythonArgs, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const result = new Promise<string>((resolveResult, rejectResult) => {
    child.once("error", rejectResult);
    child.once("close", (code: number | null) => {
      try {
        const payload = JSON.parse(Buffer.concat(stdout).toString("utf8")) as { transcript?: string; error?: string };
        if (code !== 0) {
          rejectResult(new Error(payload.error ?? "Local speech transcription failed"));
          return;
        }
        if (!payload.transcript?.trim()) throw new Error("No speech could be detected in this recording");
        resolveResult(payload.transcript.trim());
      } catch (error) {
        rejectResult(code === 0 ? error : new Error("Local speech transcription failed"));
      }
    });
  });

  child.stdin.end(buffer);
  const timeout = setTimeout(() => child.kill(), 15 * 60 * 1000);
  try {
    return await result;
  } finally {
    clearTimeout(timeout);
  }
}
