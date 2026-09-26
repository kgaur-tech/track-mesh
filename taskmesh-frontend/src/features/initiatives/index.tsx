"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, Code2, FileCode2, Layers3, Mic2, Sparkles, Upload, Video } from "lucide-react";
import { Badge, Button, Card, SectionHeader, Select, Textarea } from "@/components/ui";
import { englishCurriculum } from "@/mock/curriculum";
import { leaderboard } from "@/mock";
import { cn } from "@/lib/utils";

type Mode = "global" | "private";
type EvaluationStage = "idle" | "uploading" | "processing" | "complete" | "error";
type SubmissionEvaluation = {
  score: number;
  strengths: string[];
  weaknesses: string[];
  feedback: string;
  improvements: string[];
  transcript?: string;
};

async function requestEvaluation(body: FormData | Record<string, string>): Promise<SubmissionEvaluation> {
  const isFormData = body instanceof FormData;
  const response = await fetch("/api/local/evaluate", {
    method: "POST",
    headers: isFormData ? undefined : { "content-type": "application/json" },
    body: isFormData ? body : JSON.stringify(body),
  });
  const payload = await response.json() as { evaluation?: SubmissionEvaluation; error?: string };
  if (!response.ok || !payload.evaluation) throw new Error(payload.error ?? "Evaluation could not be completed");
  return payload.evaluation;
}

function evaluationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Evaluation could not be completed";
  if (/no credits remaining|insufficient_quota|credit_balance_exhausted/i.test(message)) {
    return "The AI service has no API credits available. Add credits to the configured OpenAI account, then retry.";
  }
  return message;
}

function ModeSwitcher({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return <div className={cn("mode-switcher", mode === "private" && "mode-private")} role="tablist" aria-label="Leaderboard mode">
    {(["global", "private"] as const).map((item) => <button key={item} role="tab" aria-selected={mode === item} onClick={() => onChange(item)} className={mode === item ? "active" : ""}>{item === "global" ? "Global" : "Private group"}</button>)}
  </div>;
}

function Leaderboard({ mode, kind }: { mode: Mode; kind: "english" | "dsa" }) {
  const title = mode === "global" ? "Global standings" : "Private group standings";
  const entries = mode === "global" ? leaderboard : leaderboard.slice(0, 3);
  return <Card className="leaderboard-card p-0">
    <div className="border-b border-[hsl(var(--border))] px-5 py-5 sm:px-6"><SectionHeader eyebrow={kind === "english" ? "Speaking practice" : "Problem solving"} title={title} description="Practice points and active streaks across the community." /></div>
    <div className="overflow-x-auto p-5 sm:p-6"><table className="w-full min-w-[420px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">Rank</th><th className="p-3">Participant</th><th className="p-3">Streak</th><th className="p-3">Points</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.rank} className="border-b last:border-0"><td className="p-3 font-semibold">#{entry.rank}</td><td className="p-3">{entry.name}</td><td className="p-3">{entry.streak} days</td><td className="p-3 font-semibold">{entry.score}</td></tr>)}</tbody></table></div>
  </Card>;
}

function EvaluationState({ stage, evaluation, error }: { stage: EvaluationStage; evaluation: SubmissionEvaluation | null; error: string }) {
  if (stage === "idle") return <div className="evaluation-idle"><Sparkles className="h-5 w-5" /><span>Submit your attempt to see its evaluation.</span></div>;
  if (stage === "error") return <p className="text-sm text-red-700" role="alert">{error}</p>;
  if (stage !== "complete" || !evaluation) {
    const copy = stage === "uploading" ? "Preparing your submission" : "AI is reviewing your work";
    return <div className="evaluation-state" role="status" aria-live="polite"><span className="status-dot" /><div><p>{copy}</p><span>{stage === "uploading" ? "Uploading your response" : "Transcribing and evaluating your attempt"}</span></div></div>;
  }
  return <div className="evaluation-state" role="status" aria-live="polite"><span className="status-dot complete" /><div className="min-w-0 flex-1"><p>Evaluation complete · {evaluation.score}%</p><p className="mt-2 text-sm leading-6">{evaluation.feedback}</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><h4 className="text-sm font-semibold">Strengths</h4><ul className="mt-2 space-y-1 text-sm">{evaluation.strengths.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div><div><h4 className="text-sm font-semibold">Areas to improve</h4><ul className="mt-2 space-y-1 text-sm">{[...evaluation.weaknesses, ...evaluation.improvements].map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div></div>{evaluation.transcript ? <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">View transcript</summary><p className="mt-2 whitespace-pre-wrap leading-6">{evaluation.transcript}</p></details> : null}</div></div>;
}

function Guidelines({ kind }: { kind: "english" | "dsa" }) {
  const items = kind === "english" ? ["Speak naturally; do not over-memorize.", "Stay on topic and prioritize clear speech.", "Keep going through small mistakes.", "Use a quiet space and clear audio.", "Review feedback and practice consistently."] : ["Understand the problem before coding.", "Explain your approach and test edge cases.", "Consider time and space complexity.", "Write readable code with meaningful names.", "Learn from each evaluation."];
  return <Card className="guidelines"><p className="eyebrow">Submission guidance</p><h3>Make each attempt useful.</h3><ul>{items.map((item) => <li key={item}><CheckCircle2 className="h-4 w-4" />{item}</li>)}</ul></Card>;
}

function EnglishSubmission() {
  const [file, setFile] = useState<File | null>(null); const [stage, setStage] = useState<EvaluationStage>("idle"); const [evaluation, setEvaluation] = useState<SubmissionEvaluation | null>(null); const [error, setError] = useState("");
  async function submit() {
    if (!file) return;
    setError(""); setEvaluation(null); setStage("uploading");
    const body = new FormData(); body.append("kind", "english"); body.append("file", file); body.append("taskDescription", "Speak for 60 to 90 seconds. Assess clear, natural English, grammar, vocabulary, fluency, and how directly the response addresses the prompt.");
    try { setStage("processing"); setEvaluation(await requestEvaluation(body)); setStage("complete"); }
    catch (caught) { setError(evaluationErrorMessage(caught)); setStage("error"); }
  }
  return <Card className="submission-panel"><SectionHeader eyebrow="Your response" title="Submit your speaking practice" description="Choose an audio or video recording to complete today’s challenge." />
    <label className="upload-zone" htmlFor="english-upload"><Upload className="h-6 w-6" /><span>{file?.name ?? "Drop an audio or video file here"}</span><small>{file ? "Ready to submit" : "MP3, WAV, MP4, MOV, M4A, WebM, OGG · clear audio recommended"}</small><input id="english-upload" className="sr-only" type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/webm,audio/m4a,audio/x-m4a,audio/ogg,audio/flac,video/mp4,video/webm,video/quicktime" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setStage("idle"); setEvaluation(null); setError(""); }} /></label>
    {file ? <button className="text-button" onClick={() => { setFile(null); setStage("idle"); setEvaluation(null); setError(""); }}>Remove and choose another file</button> : null}
    <div className="mt-5 flex flex-wrap gap-3"><Button onClick={submit} disabled={!file || stage === "uploading" || stage === "processing" || stage === "complete"}>{stage === "uploading" || stage === "processing" ? "Evaluating…" : stage === "complete" ? "Submitted" : "Submit response"}</Button></div><div className="mt-5"><EvaluationState stage={stage} evaluation={evaluation} error={error} /></div>
  </Card>;
}

function DsaSubmission() {
  const [stage, setStage] = useState<EvaluationStage>("idle"); const [code, setCode] = useState(""); const [language, setLanguage] = useState("javascript"); const [evaluation, setEvaluation] = useState<SubmissionEvaluation | null>(null); const [error, setError] = useState("");
  async function submit() {
    if (!code.trim()) return;
    setError(""); setEvaluation(null); setStage("processing");
    try { setEvaluation(await requestEvaluation({ kind: "dsa", content: code, programmingLanguage: language, taskDescription: "Given an array of integers and a target, return the indices of two numbers that add up to the target. Evaluate correctness, algorithm choice, complexity, edge cases, and code quality." })); setStage("complete"); }
    catch (caught) { setError(evaluationErrorMessage(caught)); setStage("error"); }
  }
  return <Card className="submission-panel"><SectionHeader eyebrow="Your solution" title="Submit code for review" description="Write your approach and implementation, then submit for a structured review." />
    <div className="code-toolbar"><Select aria-label="Programming language" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="javascript">JavaScript</option><option value="python">Python</option><option value="java">Java</option><option value="cpp">C++</option></Select><span>Solution editor</span></div>
    <Textarea aria-label="Code solution" value={code} onChange={(e) => { setCode(e.target.value); setStage("idle"); setEvaluation(null); setError(""); }} placeholder="// Explain your approach, then write your solution here." className="code-input" />
    <div className="mt-5 flex flex-wrap gap-3"><Button onClick={submit} disabled={!code.trim() || stage === "processing" || stage === "uploading" || stage === "complete"}>{stage === "processing" ? "Evaluating…" : stage === "complete" ? "Submitted" : "Submit solution"}</Button></div><div className="mt-5"><EvaluationState stage={stage} evaluation={evaluation} error={error} /></div>
  </Card>;
}

export function InitiativeExperience({ kind }: { kind: "english" | "dsa" }) {
  const [mode, setMode] = useState<Mode>("global"); const [selectedDay, setSelectedDay] = useState(1);
  const english = kind === "english"; const dayTitle = englishCurriculum[selectedDay - 1];
  return <main className={cn("initiative-page", english ? "initiative-english" : "initiative-dsa")}>
    <section className="initiative-hero"><div><p className="eyebrow">Core initiative</p><h1>{english ? "English Initiative" : "DSA Initiative"}</h1><p>{english ? "Build speaking confidence through focused daily practice, thoughtful submissions, and useful feedback." : "Strengthen algorithmic thinking through deliberate problems, clear explanations, and repeatable review."}</p></div><div className="metric-slots"><div><span>Current streak</span><b>12 days</b></div><div><span>{english ? "Speaking score" : "Problem score"}</span><b>{english ? "74%" : "87%"}</b></div><div><span>Consistency</span><b>86%</b></div><div><span>Completed days</span><b>18</b></div></div></section>
    <section className="initiative-section"><div className="section-top"><div><p className="eyebrow">Community</p><h2>Find your place in the practice.</h2></div><ModeSwitcher mode={mode} onChange={setMode} /></div><Leaderboard kind={kind} mode={mode} /></section>
    <section className="initiative-section challenge-layout"><Card className="daily-challenge"><div className="challenge-kicker"><Badge tone={english ? "orange" : "info"}>{english ? `Day ${selectedDay}` : "Today’s problem"}</Badge>{english ? <span>Speaking challenge</span> : <Badge tone="warning">Medium</Badge>}</div><h2>{english ? dayTitle : "Two Sum: explain before you optimize"}</h2><p>{english ? "Speak for 60–90 seconds. Organize your response naturally, use your own examples, and focus on being understood." : "Given an array of integers and a target, return the indices of two numbers that add up to the target. Explain the tradeoff in your chosen approach."}</p>
      {english ? <div className="challenge-details"><span><Mic2 className="h-4 w-4" />60–90 seconds</span><span><Video className="h-4 w-4" />Audio or video</span><span><BookOpen className="h-4 w-4" />Clear, honest attempt</span></div> : <div className="problem-details"><div><b>Topics</b><span>Arrays · Hash map</span></div><div><b>Expected complexity</b><span>O(n) time · O(n) space</span></div><div><b>Example</b><code>[2, 7, 11, 15], target = 9 → [0, 1]</code></div></div>}</Card>
      {english ? <Card className="backlog-card"><p className="eyebrow">Missed a day?</p><h3>Practice a backlog challenge.</h3><p>Choose any earlier prompt and complete it at your own pace.</p><Select aria-label="Choose a challenge day" value={String(selectedDay)} onChange={(e) => setSelectedDay(Number(e.target.value))}>{englishCurriculum.map((topic, index) => <option key={topic} value={index + 1}>Day {index + 1}: {topic}</option>)}</Select></Card> : <Card className="backlog-card"><p className="eyebrow">Problem notes</p><h3>Before you submit</h3><p>State your approach, cover edge cases, and validate complexity. This creates a stronger review context.</p><div className="mt-5 flex items-center gap-2 text-sm"><FileCode2 className="h-4 w-4" />One solution per challenge</div></Card>}</section>
    {english ? <EnglishSubmission /> : <DsaSubmission />}
    <section className="initiative-section grid gap-5 lg:grid-cols-[1.1fr_0.9fr]"><Guidelines kind={kind} /><Card><p className="eyebrow">Evaluation</p><h3 className="mt-2 text-2xl font-semibold">Your review criteria</h3><p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{english ? "Your recording is reviewed for fluency, vocabulary, grammar, clarity, and how well it addresses the prompt." : "Your solution is reviewed for correctness, algorithm choice, complexity, edge cases, and readability."}</p><p className="mt-5 text-sm font-medium">Submit your attempt above to see its score, strengths, and recommended next steps.</p></Card></section>
  </main>;
}

const future = ["Web Development", "Communication", "System Design", "Competitive Programming", "Interview Preparation", "Public Speaking"];
export function MorePage() { return <main className="marketing-page"><section className="page-intro"><p className="eyebrow">Initiative directory</p><h1>A focused path for each kind of growth.</h1><p>English and DSA are the active TaskMesh initiatives. Future tracks are shown as a roadmap, not as active products.</p></section><section className="directory-grid"><Link className="initiative-link english" href="/english"><Mic2 /><div><p>Active initiative</p><h2>English</h2><span>Daily speaking practice with submission-ready structure.</span></div><ChevronRight /></Link><Link className="initiative-link dsa" href="/dsa"><Code2 /><div><p>Active initiative</p><h2>DSA</h2><span>Deliberate algorithm practice and code review preparation.</span></div><ChevronRight /></Link>{future.map((item) => <article className="coming-soon" key={item}><Layers3 /><Badge tone="slate">Coming soon</Badge><h2>{item}</h2><p>A future initiative concept on the TaskMesh roadmap.</p></article>)}</section></main>; }

export function AboutPage() {
  const steps = [["Observe", "Peer groups often rely on informal tracking and manual follow-up."], ["Structure", "TaskMesh turns a goal into a clear recurring practice flow."], ["Submit", "Participants share an honest attempt in the format the task requires."], ["Reflect", "Evaluation and consistency signals make the next step clearer."]];
  return <main className="marketing-page about-page"><section className="page-intro"><p className="eyebrow">About TaskMesh</p><h1>Growth is easier to start than to sustain.</h1><p>TaskMesh is built around a practical observation: communities can create motivation, but informal tracking makes consistency, verification, and useful feedback difficult to sustain at scale.</p></section><section className="story-grid"><Card><p className="eyebrow">The problem</p><h2>Momentum gets lost between intention and evidence.</h2><p>Chat groups are great for encouragement, but they rarely create a durable record of practice, clear expectations for submissions, or a dependable way to review progress.</p></Card><Card><p className="eyebrow">The response</p><h2>A calmer operating system for peer-driven growth.</h2><p>TaskMesh brings initiatives, daily work, submissions, evaluation, and progress into one deliberate rhythm—without making learning feel like a spreadsheet.</p></Card></section><section className="story-section"><SectionHeader eyebrow="How it works" title="A repeatable loop, not a one-time challenge." /><div className="flow-grid">{steps.map(([title, copy], i) => <article key={title}><span>0{i + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section><section className="story-grid"><Card><p className="eyebrow">Why AI-assisted evaluation</p><h2>Feedback should be structured enough to act on.</h2><p>Evaluation turns each submitted attempt into clear strengths, improvement areas, and a useful next practice step.</p></Card><Card><p className="eyebrow">Where we begin</p><h2>English and DSA.</h2><p>Speaking practice and algorithmic problem solving are the first active initiatives. The longer-term vision is a flexible platform for more peer-led growth paths.</p></Card></section></main>;
}
