"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Code2, Mic2, Sparkles } from "lucide-react";
import { Button, Card, SectionHeader } from "@/components/ui";
import { activeTasks, consistencyData, currentLeader, currentStudent, feedback, groups, initiatives, leaderboard, leaderChart, leaderGroups, leaderMetrics, notifications, progressData, skillScores, submissions } from "@/mock";

const benefits = ["A clear daily practice rhythm", "Submission formats that fit the work", "Structured feedback after each attempt", "A shared space for accountable growth"];

export function LandingPage() {
  return <main className="marketing-page home-page">
    <section className="home-hero"><div><p className="eyebrow">Practice with direction</p><h1>Make daily effort <em>visible.</em></h1><p>TaskMesh gives peer-driven initiatives a clear rhythm: practice deliberately, submit honestly, and use feedback to choose the next useful step.</p><div className="mt-8 flex flex-wrap gap-3"><Button asChild><Link href="/more">Explore initiatives <ArrowRight className="h-4 w-4" /></Link></Button><Button variant="outline" asChild><Link href="/about">Why TaskMesh</Link></Button></div></div><div className="hero-product" aria-label="TaskMesh product preview"><div className="hero-product-top"><span>Today’s focus</span><span className="live-dot">In rhythm</span></div><div className="hero-task"><div className="hero-icon"><Sparkles className="h-5 w-5" /></div><div><small>English initiative</small><strong>Speak with a clear point of view.</strong><p>One focused attempt. A useful next step.</p></div></div><div className="hero-flow"><span>Practice</span><i /><span>Submit</span><i /><span>Reflect</span></div><div className="hero-note">Progress is built from repeatable effort—not noisy dashboards.</div></div></section>
    <section className="home-section"><SectionHeader eyebrow="Start here" title="Two focused initiatives, designed for deliberate practice." /><div className="core-initiative-grid"><Link href="/english" className="core-initiative english"><Mic2 /><p>English initiative</p><h2>Speak with confidence.</h2><span>Daily speaking prompts, audio/video submission, and feedback-ready practice.</span><b>Explore English <ArrowRight className="h-4 w-4" /></b></Link><Link href="/dsa" className="core-initiative dsa"><Code2 /><p>DSA initiative</p><h2>Think in algorithms.</h2><span>Focused problem solving, thoughtful code submissions, and review-ready solutions.</span><b>Explore DSA <ArrowRight className="h-4 w-4" /></b></Link></div></section>
    <section className="home-section split-section"><div><p className="eyebrow">Why TaskMesh</p><h2>Consistency needs more than good intentions.</h2><p>Peer communities create energy. TaskMesh gives that energy a practical structure: a task, an attempt, a record of progress, and a clearer next move.</p></div><ul className="benefit-list">{benefits.map((item) => <li key={item}><CheckCircle2 className="h-4 w-4" />{item}</li>)}</ul></section>
    <section className="home-section"><SectionHeader eyebrow="The practice loop" title="A simple system for showing up." /><div className="practice-loop">{[["01", "Choose", "Open a focused daily challenge."], ["02", "Practice", "Work in the format the task requires."], ["03", "Submit", "Share a genuine attempt."], ["04", "Reflect", "Use evaluation and consistency signals."]].map(([number, title, copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="home-cta"><div><p className="eyebrow">Ready when you are</p><h2>Choose one initiative. Start with one honest attempt.</h2></div><Button asChild><Link href="/more">View initiatives <ArrowRight className="h-4 w-4" /></Link></Button></section>
  </main>;
}

export function SignInView() {
  return <CredentialsForm mode="sign-in" />;
}

export function SignUpView() {
  return <CredentialsForm mode="sign-up" />;
}

function CredentialsForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isSignUp = mode === "sign-up";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    try {
      if (process.env.NODE_ENV === "development") {
        router.push("/app/dashboard");
        router.refresh();
        return;
      }

      if (isSignUp) {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: String(form.get("name") ?? ""), email, password }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to create your account");
      }

      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) throw new Error("Email or password is incorrect");
      router.push("/app/dashboard");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{isSignUp ? "Create account" : "Welcome back"}</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-950">{isSignUp ? "Start with TaskMesh" : "Sign in to TaskMesh"}</h1>
        <p className="mt-3 text-sm text-slate-600">Access your initiatives, tasks, and progress tracking.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          {isSignUp ? <label className="block text-sm font-medium text-slate-700">Name<input required name="name" autoComplete="name" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label> : null}
          <label className="block text-sm font-medium text-slate-700">Email<input required name="email" type="email" autoComplete="email" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="block text-sm font-medium text-slate-700">Password<input required name="password" type="password" minLength={isSignUp ? 10 : 1} autoComplete={isSignUp ? "new-password" : "current-password"} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
          <Button type="submit" className="w-full justify-center" disabled={submitting}>{submitting ? "Please wait" : isSignUp ? "Create account" : "Sign in"}</Button>
        </form>
        <div className="my-6 border-t border-slate-200" />
        <Button variant="outline" className="w-full justify-center" onClick={() => process.env.NODE_ENV === "development" ? router.push("/app/dashboard") : signIn("google", { callbackUrl: "/app/dashboard" })}>
          Continue with Google
        </Button>
        <p className="mt-5 text-center text-sm text-slate-600">{isSignUp ? "Already have an account?" : "New to TaskMesh?"} <Link className="font-medium text-slate-950 underline" href={isSignUp ? "/sign-in" : "/sign-up"}>{isSignUp ? "Sign in" : "Create an account"}</Link></p>
      </div>
    </div>
  );
}

function MetricTiles({ items }: { items: Array<{ label: string; value: string; detail?: string }> }) {
  return <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map((item) => <Card key={item.label}><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{item.value}</p>{item.detail ? <p className="mt-1 text-xs text-slate-500">{item.detail}</p> : null}</Card>)}</div>;
}

function ParticipantView({ slug }: { slug: string[] }) {
  const key = slug[0] ?? "dashboard";
  const [saved, setSaved] = useState(false);
  const action = <Button asChild><Link href={key === "initiatives" ? "/more" : "/english"}>{key === "initiatives" ? "Browse initiatives" : "Open English"}</Link></Button>;
  const header = (title: string, description: string) => <SectionHeader eyebrow="Participant workspace" title={title} description={description} action={action} />;
  const taskCards = activeTasks.map((task) => <Card key={task.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase text-slate-500">{task.difficulty} · {task.dueLabel}</p><h2 className="mt-2 text-lg font-semibold">{task.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{task.description}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">{task.status}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${task.progress}%` }} /></div><div className="mt-4 flex items-center justify-between text-xs text-slate-500"><span>{task.progress}% complete</span><Link className="font-medium text-slate-900 underline" href={task.initiativeId === "speaking-club" ? "/english" : "/dsa"}>Open task</Link></div></Card>);

  if (key === "dashboard") return <div>{header(currentStudent.headline, currentStudent.subtitle)}<MetricTiles items={[{ label: "Current streak", value: "12 days", detail: "Personal best: 18 days" }, { label: "Tasks this week", value: "6 of 7", detail: "+1 from last week" }, { label: "Average score", value: "81%", detail: "Across recent submissions" }, { label: "Practice time", value: "4h 35m", detail: "This week" }]} /><div className="mt-6 grid gap-5 xl:grid-cols-2"><section><h2 className="mb-3 text-lg font-semibold">Today’s work</h2><div className="grid gap-3">{taskCards.slice(0, 2)}</div></section><section><h2 className="mb-3 text-lg font-semibold">Your initiatives</h2><div className="grid gap-3">{initiatives.slice(0, 2).map((item) => <Card key={item.id}><p className="text-xs font-medium uppercase text-slate-500">{item.category} · {item.duration}</p><h3 className="mt-2 text-lg font-semibold">{item.title}</h3><p className="mt-1 text-sm text-slate-600">{item.description}</p><Link className="mt-4 inline-block text-sm font-medium underline" href={item.id === "speaking-club" ? "/english" : "/dsa"}>Continue practice</Link></Card>)}</div></section></div></div>;

  if (key === "initiatives") return <div>{header("Initiatives", "Choose a track and keep your practice moving.")}<div className="mt-6 grid gap-4 md:grid-cols-2">{initiatives.map((item) => <Card key={item.id}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium uppercase text-slate-500">{item.category} · {item.difficulty}</p><h2 className="mt-2 text-xl font-semibold">{item.title}</h2></div><span className="text-sm font-semibold">{item.rating} ★</span></div><p className="mt-3 text-sm leading-6 text-slate-600">{item.description}</p><div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-100 py-3 text-sm"><span><b>{item.members}</b><small className="block text-slate-500">Members</small></span><span><b>{item.completionRate}%</b><small className="block text-slate-500">Completion</small></span><span><b>{item.duration}</b><small className="block text-slate-500">Duration</small></span></div><Link className="mt-4 inline-block text-sm font-medium underline" href={item.id === "speaking-club" ? "/english" : item.id === "dsa-30" ? "/dsa" : "/more"}>View initiative</Link></Card>)}</div></div>;

  if (key === "tasks") return <div>{header("Tasks", "Your current challenges and their progress.")}<div className="mt-6 grid gap-3">{taskCards}</div></div>;

  if (key === "submissions") return <div>{header("Submissions", "Review your recent attempts and their status.")}<div className="mt-6 grid gap-3">{submissions.map((item) => <Card key={item.id}><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-slate-500">{item.submittedAt} · {item.channel}</p><h2 className="mt-1 font-semibold">{item.title}</h2><p className="mt-1 text-sm text-slate-600">Reviewed by {item.reviewer}</p></div><div className="text-right"><span className="text-sm font-medium">{item.status}</span>{item.score ? <p className="mt-1 text-xl font-semibold">{item.score}%</p> : null}</div></div></Card>)}</div></div>;

  if (key === "evaluation") return <div>{header("Evaluation", "Feedback from your latest practice attempts.")}<div className="mt-6 grid gap-4">{feedback.map((item) => <Card key={item.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase text-slate-500">{item.tone} feedback</p><h2 className="mt-2 text-lg font-semibold">Submission review</h2></div><span className="text-2xl font-semibold">{item.score}%</span></div><p className="mt-3 text-sm leading-6 text-slate-600">{item.summary}</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><h3 className="text-sm font-semibold">Strengths</h3><ul className="mt-2 space-y-1 text-sm text-slate-600">{item.strengths.map((line) => <li key={line}>✓ {line}</li>)}</ul></div><div><h3 className="text-sm font-semibold">Next steps</h3><ul className="mt-2 space-y-1 text-sm text-slate-600">{item.improvements.map((line) => <li key={line}>→ {line}</li>)}</ul></div></div></Card>)}</div></div>;

  if (key === "progress") return <div>{header("Progress", "A clear view of your consistency and skill development.")}<MetricTiles items={[{ label: "Practice consistency", value: "86%" }, { label: "Completed challenges", value: "24" }, { label: "Active streak", value: "12 days" }, { label: "Average score", value: "81%" }]} /><div className="mt-6 grid gap-5 xl:grid-cols-2"><Card><h2 className="font-semibold">Weekly practice score</h2><div className="mt-5 flex h-48 items-end gap-3">{progressData.map((point) => <div key={point.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-xs text-slate-500">{point.value}</span><div className="w-full rounded-t bg-emerald-600" style={{ height: `${point.value}%` }} /><span className="text-xs text-slate-500">{point.label}</span></div>)}</div></Card><Card><h2 className="font-semibold">Skill scores</h2><div className="mt-5 space-y-4">{skillScores.map((item) => <div key={item.skill}><div className="flex justify-between text-sm"><span>{item.skill}</span><span>{item.score}% · +{item.delta}</span></div><div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${item.score}%` }} /></div></div>)}</div><h3 className="mt-6 text-sm font-semibold">Consistency trend</h3><p className="mt-2 text-sm text-slate-600">{consistencyData.map((point) => `${point.label}: ${point.value}%`).join(" · ")}</p></Card></div></div>;

  if (key === "leaderboard") return <div>{header("Leaderboard", "See how your practice compares across initiatives.")}<Card className="mt-6 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">Rank</th><th className="p-3">Participant</th><th className="p-3">Initiative</th><th className="p-3">Streak</th><th className="p-3">Points</th></tr></thead><tbody>{leaderboard.map((person) => <tr key={person.rank} className="border-b last:border-0"><td className="p-3 font-semibold">#{person.rank}</td><td className="p-3">{person.name}</td><td className="p-3">{person.initiative}</td><td className="p-3">{person.streak} days</td><td className="p-3 font-semibold">{person.score}</td></tr>)}</tbody></table></Card></div>;

  if (key === "groups") return <div>{header("Groups", "Practice alongside a focused accountability group.")}<div className="mt-6 grid gap-4 md:grid-cols-2">{groups.map((group) => <Card key={group.id}><p className="text-xs font-medium uppercase text-slate-500">Rank #{group.leaderboardRank}</p><h2 className="mt-2 text-lg font-semibold">{group.name}</h2><p className="mt-2 text-sm text-slate-600">{group.description}</p><p className="mt-4 text-sm">{group.members} members</p><Button className="mt-4" variant="outline" onClick={() => setSaved(true)}>{saved ? "Joined" : "Join group"}</Button></Card>)}</div></div>;

  if (key === "notifications") return <div>{header("Notifications", "Recent updates from your initiatives.")}<div className="mt-6 grid gap-3">{notifications.map((item) => <Card key={item.id}><div className="flex gap-3"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600" /><div><div className="flex flex-wrap items-baseline gap-2"><h2 className="font-semibold">{item.title}</h2><span className="text-xs text-slate-500">{item.time}</span></div><p className="mt-1 text-sm text-slate-600">{item.body}</p></div></div></Card>)}</div></div>;

  if (key === "profile") return <div>{header("Profile", "Your account and practice preferences.")}<Card className="mt-6 max-w-2xl"><p className="text-xs font-medium uppercase text-slate-500">Participant</p><h2 className="mt-2 text-xl font-semibold">{currentStudent.name}</h2><p className="mt-1 text-sm text-slate-600">{currentStudent.location}</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><p className="text-sm"><span className="text-slate-500">Membership</span><br />{currentStudent.plan}</p><p className="text-sm"><span className="text-slate-500">Active initiatives</span><br />{initiatives.slice(0, 2).map((item) => item.title).join(" · ")}</p></div></Card></div>;

  if (key === "settings") return <div>{header("Settings", "Manage your workspace preferences.")}<Card className="mt-6 max-w-2xl"><h2 className="font-semibold">Notifications</h2><label className="mt-4 flex items-center justify-between gap-4 border-b py-3 text-sm"><span>Task reminders</span><input type="checkbox" defaultChecked className="h-4 w-4 accent-emerald-700" /></label><label className="flex items-center justify-between gap-4 border-b py-3 text-sm"><span>Evaluation updates</span><input type="checkbox" defaultChecked className="h-4 w-4 accent-emerald-700" /></label><Button className="mt-5" onClick={() => setSaved(true)}>{saved ? "Preferences saved" : "Save preferences"}</Button></Card></div>;

  return <div>{header("Your practice space", "Choose an initiative to begin a focused practice session.")}<div className="mt-6 grid gap-3">{taskCards}</div></div>;
}

function LeaderView({ slug }: { slug: string[] }) {
  const section = slug[0] ?? "dashboard";
  const isReports = slug.includes("reports");
  const title = isReports ? "Reports" : section === "initiatives" ? "Initiatives" : section === "groups" ? "Groups" : section === "notifications" ? "Notifications" : section === "members" ? "Participants" : "Initiative operations";
  const header = <SectionHeader eyebrow="Leader workspace" title={title} description={currentLeader.subtitle} action={<Button asChild><Link href="/english">Preview English</Link></Button>} />;
  if (section === "initiatives" && !isReports) return <div>{header}<div className="mt-6 grid gap-4 md:grid-cols-2">{initiatives.map((item) => <Card key={item.id}><p className="text-xs font-medium uppercase text-slate-500">{item.category} · {item.stage}</p><h2 className="mt-2 text-xl font-semibold">{item.title}</h2><p className="mt-2 text-sm text-slate-600">{item.description}</p><div className="mt-4 grid grid-cols-3 gap-2 border-y py-3 text-sm"><span><b>{item.members}</b><small className="block text-slate-500">Members</small></span><span><b>{item.activeMembers}</b><small className="block text-slate-500">Active</small></span><span><b>{item.completionRate}%</b><small className="block text-slate-500">Complete</small></span></div><Link className="mt-4 inline-block text-sm font-medium underline" href={`/leader/initiatives/${item.id}/reports`}>Open report</Link></Card>)}</div></div>;
  if (section === "groups") return <div>{header}<div className="mt-6 grid gap-4 md:grid-cols-2">{leaderGroups.map((group) => <Card key={group.name}><h2 className="text-lg font-semibold">{group.name}</h2><div className="mt-4 flex justify-between text-sm"><span>{group.members} members</span><span>{group.active} active</span></div><div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${group.completion}%` }} /></div><p className="mt-2 text-xs text-slate-500">{group.completion}% completion</p></Card>)}</div></div>;
  if (section === "notifications") return <div>{header}<div className="mt-6 grid gap-3">{notifications.map((item) => <Card key={item.id}><p className="text-xs text-slate-500">{item.time}</p><h2 className="mt-1 font-semibold">{item.title}</h2><p className="mt-1 text-sm text-slate-600">{item.body}</p></Card>)}</div></div>;
  if (section === "members") return <div>{header}<Card className="mt-6 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">Participant</th><th className="p-3">Initiative</th><th className="p-3">Streak</th><th className="p-3">Points</th></tr></thead><tbody>{leaderboard.map((person) => <tr key={person.rank} className="border-b last:border-0"><td className="p-3">{person.name}</td><td className="p-3">{person.initiative}</td><td className="p-3">{person.streak} days</td><td className="p-3">{person.score}</td></tr>)}</tbody></table></Card></div>;
  if (isReports) return <div>{header}<MetricTiles items={[{ label: "Submissions", value: String(submissions.length) }, { label: "Evaluated", value: String(submissions.filter((item) => item.score > 0).length) }, { label: "Average score", value: `${Math.round(submissions.reduce((total, item) => total + item.score, 0) / submissions.filter((item) => item.score > 0).length)}%` }, { label: "Pending review", value: String(submissions.filter((item) => item.score === 0).length) }]} /><Card className="mt-6 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-3">Work</th><th className="p-3">Status</th><th className="p-3">Submitted</th><th className="p-3">Score</th></tr></thead><tbody>{submissions.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="p-3">{item.title}</td><td className="p-3">{item.status}</td><td className="p-3">{item.submittedAt}</td><td className="p-3">{item.score ? `${item.score}%` : "Pending"}</td></tr>)}</tbody></table></Card></div>;
  return <div>{header}<MetricTiles items={leaderMetrics.map((item) => ({ label: item.label, value: item.value, detail: item.delta }))} /><div className="mt-6 grid gap-5 xl:grid-cols-2"><Card><h2 className="font-semibold">Weekly completion</h2><div className="mt-5 flex h-48 items-end gap-3">{leaderChart.map((point) => <div key={point.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-xs text-slate-500">{point.value}%</span><div className="w-full rounded-t bg-orange-500" style={{ height: `${point.value}%` }} /><span className="text-xs text-slate-500">{point.label}</span></div>)}</div></Card><section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Initiative health</h2><Link className="text-sm underline" href="/leader/initiatives">View all</Link></div><div className="grid gap-3">{leaderGroups.map((group) => <Card key={group.name}><div className="flex justify-between gap-3"><h3 className="font-semibold">{group.name}</h3><span className="text-sm">{group.active}/{group.members} active</span></div><div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${group.completion}%` }} /></div><p className="mt-2 text-xs text-slate-500">{group.completion}% completion</p></Card>)}</div></section></div><div className="mt-6"><h2 className="mb-3 text-lg font-semibold">Recent submissions</h2><div className="grid gap-3">{submissions.map((item) => <Card key={item.id} className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.submittedAt} · {item.reviewer}</p></div><span className="text-sm">{item.score ? `${item.score}%` : item.status}</span></Card>)}</div></div></div>;
}

export function AppRouterFrame({ role, slug }: { role: "student" | "leader"; slug: string[] }) { return role === "leader" ? <LeaderView slug={slug} /> : <ParticipantView slug={slug} />; }
