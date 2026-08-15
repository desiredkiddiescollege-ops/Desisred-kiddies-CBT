import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { createHash, randomBytes } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  Account,
  AnswerInput,
  CreateExamBody,
  CreateQuestionBody,
  CreateSubjectBody,
  GetDashboardSummaryResponse,
  GetExamResponse,
  GetAdminSummaryResponse,
  GetAttemptParams,
  GetExamParams,
  GetMeResponse,
  GetSchoolInfoResponse,
  GenerateEpinsBody,
  GenerateEpinsResponse,
  CheckResultBody,
  CheckResultResponse,
  UpdateEpinBody,
  UpdateEpinParams,
  UpdateSchoolInfoBody,
  UpdateSchoolInfoResponse,
  ListAdminExamsResponse,
  ListAdminResultsResponse,
  ListQuestionsQueryParams,
  ListResultsResponse,
  ListStudentsResponse,
  ListSubjectsResponse,
  ListExamsQueryParams,
  SaveAttemptAnswerBody,
  SaveAttemptAnswerParams,
  StartAttemptParams,
  SubmitAttemptParams,
  UpdateExamBody,
  UpdateExamParams,
  UpdateQuestionBody,
  UpdateQuestionParams,
  UpdateSubjectBody,
  UpdateSubjectParams,
} from "@workspace/api-zod";
import {
  attemptsTable,
  db,
  epinsTable,
  examQuestionsTable,
  examsTable,
  questionsTable,
  resultsTable,
  schoolInfoTable,
  subjectsTable,
  usersTable,
  type User,
} from "@workspace/db";

type AuthedRequest = Request & { cbtUser?: User };

const router: IRouter = Router();

async function ensureSchoolInfo() {
  const existing = await db.select({ id: schoolInfoTable.id }).from(schoolInfoTable).limit(1);
  if (!existing.length) {
    await db.insert(schoolInfoTable).values({}).onConflictDoNothing();
  }
}

function authUserId(req: Request) {
  const auth = getAuth(req);
  return auth.userId ?? (auth.sessionClaims as unknown as { userId?: string } | undefined)?.userId;
}

async function getOrCreateUser(req: AuthedRequest) {
  const clerkUserId = authUserId(req);
  if (!clerkUserId) return null;
  const claims = getAuth(req).sessionClaims as { email?: string; name?: string; firstName?: string; lastName?: string } | undefined;
  const current = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1);
  if (current[0]) {
    req.cbtUser = current[0];
    return current[0];
  }
  const total = await db.select({ count: count() }).from(usersTable);
  const name = claims?.name || [claims?.firstName, claims?.lastName].filter(Boolean).join(" ") || "Student";
  const email = claims?.email || `${clerkUserId.slice(0, 16)}@desiredkiddies.local`;
  const studentNumber = `DKC-${randomBytes(4).toString("hex").toUpperCase()}`;
  const created = await db.insert(usersTable).values({
    clerkUserId,
    name,
    email,
    studentNumber,
    role: Number(total[0]?.count ?? 0) === 0 ? "admin" : "student",
  }).returning();
  req.cbtUser = created[0];
  return created[0];
}

async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  await ensureSchoolInfo();
  const user = await getOrCreateUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.cbtUser?.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
}

function dateLabel(value: Date | null) {
  if (!value) return "Open access";
  return new Intl.DateTimeFormat("en-NG", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

async function subjectDto(subject: typeof subjectsTable.$inferSelect) {
  const total = await db.select({ count: count() }).from(questionsTable).where(eq(questionsTable.subjectId, subject.id));
  return { id: subject.id, name: subject.name, code: subject.code, questionCount: Number(total[0]?.count ?? 0) };
}

async function examDto(exam: typeof examsTable.$inferSelect) {
  const subject = (await db.select().from(subjectsTable).where(eq(subjectsTable.id, exam.subjectId)).limit(1))[0];
  const questionTotal = await db.select({ count: count() }).from(examQuestionsTable).where(eq(examQuestionsTable.examId, exam.id));
  const average = await db.select({ value: sql<number | null>`avg(${resultsTable.percentage})` }).from(resultsTable).where(eq(resultsTable.examId, exam.id));
  return {
    id: exam.id,
    title: exam.title,
    subjectId: exam.subjectId,
    subjectName: subject?.name ?? "Subject",
    dateLabel: dateLabel(exam.startAt),
    startAt: exam.startAt,
    durationMinutes: exam.durationMinutes,
    questionCount: Number(questionTotal[0]?.count ?? 0),
    status: exam.status,
    color: exam.color,
    averageScore: average[0]?.value == null ? null : Number(average[0].value),
  };
}

async function questionDto(question: typeof questionsTable.$inferSelect, safe = false) {
  const subject = (await db.select().from(subjectsTable).where(eq(subjectsTable.id, question.subjectId)).limit(1))[0];
  return {
    id: question.id,
    subjectId: question.subjectId,
    subjectName: subject?.name ?? "Subject",
    text: question.text,
    options: question.options,
    correctOption: safe ? -1 : question.correctOption,
    difficulty: question.difficulty,
  };
}

async function resultDto(result: typeof resultsTable.$inferSelect) {
  const exam = (await db.select().from(examsTable).where(eq(examsTable.id, result.examId)).limit(1))[0];
  const student = (await db.select().from(usersTable).where(eq(usersTable.id, result.userId)).limit(1))[0];
  return {
    id: result.id,
    examId: result.examId,
    examTitle: exam?.title ?? "Examination",
    studentName: student?.name ?? "Student",
    studentNumber: student?.studentNumber ?? "Not assigned",
    score: result.score,
    totalQuestions: result.totalQuestions,
    percentage: result.percentage,
    submittedAt: result.submittedAt,
    passed: result.passed,
  };
}

async function attemptDto(attempt: typeof attemptsTable.$inferSelect) {
  return {
    id: attempt.id,
    examId: attempt.examId,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    status: new Date(attempt.expiresAt) <= new Date() && attempt.status === "in_progress" ? "expired" : attempt.status,
    answers: attempt.answers,
  };
}

function schoolDto(info: typeof schoolInfoTable.$inferSelect) {
  return {
    id: info.id,
    schoolName: info.schoolName,
    proprietor: info.proprietor,
    headmistress: info.headmistress,
    phonePrimary: info.phonePrimary,
    phoneSecondary: info.phoneSecondary,
    email: info.email,
  };
}

function epinStatus(epin: typeof epinsTable.$inferSelect) {
  if (epin.status === "disabled") return "disabled";
  if (epin.expiresAt && epin.expiresAt <= new Date()) return "expired";
  if (epin.uses >= epin.maxUses) return "used";
  return "unused";
}

function epinDto(epin: typeof epinsTable.$inferSelect) {
  return {
    id: epin.id,
    code: epin.code,
    status: epinStatus(epin),
    uses: epin.uses,
    maxUses: epin.maxUses,
    expiresAt: epin.expiresAt,
    generatedAt: epin.generatedAt,
    lastUsedAt: epin.lastUsedAt,
  };
}

function epinHash(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

router.get("/school-info", async (_req, res) => {
  await ensureSchoolInfo();
  const info = (await db.select().from(schoolInfoTable).limit(1))[0]!;
  res.json(GetSchoolInfoResponse.parse(schoolDto(info)));
});

router.post("/result-checker/check", async (req, res) => {
  const body = CheckResultBody.parse(req.body);
  const examinationNumber = body.examinationNumber.trim().toUpperCase();
  const epin = (await db.select().from(epinsTable).where(eq(epinsTable.codeHash, epinHash(body.epin))).limit(1))[0];
  if (!epin || epin.status === "disabled" || (epin.expiresAt && epin.expiresAt <= new Date()) || epin.uses >= epin.maxUses) {
    res.status(400).json({ error: "This EPIN is invalid, expired, disabled, or has reached its usage limit." });
    return;
  }
  const student = (await db.select().from(usersTable).where(eq(usersTable.studentNumber, examinationNumber)).limit(1))[0];
  if (!student) {
    res.status(400).json({ error: "We could not match that examination number to a student." });
    return;
  }
  const result = (await db.select().from(resultsTable).where(eq(resultsTable.userId, student.id)).orderBy(desc(resultsTable.submittedAt)).limit(1))[0];
  if (!result) {
    res.status(404).json({ error: "No submitted result is available for this student yet." });
    return;
  }
  const updatedEpin = await db.update(epinsTable).set({ uses: epin.uses + 1, lastUsedAt: new Date() }).where(and(eq(epinsTable.id, epin.id), eq(epinsTable.uses, epin.uses))).returning();
  if (!updatedEpin[0]) {
    res.status(409).json({ error: "This EPIN was just used. Please try another EPIN." });
    return;
  }
  const school = (await db.select().from(schoolInfoTable).limit(1))[0]!;
  res.json(CheckResultResponse.parse({ school: schoolDto(school), result: await resultDto(result) }));
});

router.use(requireUser);

router.get("/me", async (req: AuthedRequest, res) => {
  const user = req.cbtUser!;
  const data = GetMeResponse.parse({ id: user.id, name: user.name, email: user.email, studentNumber: user.studentNumber, role: user.role });
  res.json(data);
});

router.get("/dashboard/summary", async (req: AuthedRequest, res) => {
  const user = req.cbtUser!;
  const active = await db.select({ count: count() }).from(attemptsTable).where(and(eq(attemptsTable.userId, user.id), eq(attemptsTable.status, "in_progress")));
  const completed = await db.select({ count: count() }).from(resultsTable).where(eq(resultsTable.userId, user.id));
  const average = await db.select({ value: sql<number | null>`avg(${resultsTable.percentage})` }).from(resultsTable).where(eq(resultsTable.userId, user.id));
  const recent = await db.select().from(resultsTable).where(eq(resultsTable.userId, user.id)).orderBy(desc(resultsTable.submittedAt)).limit(4);
  res.json(GetDashboardSummaryResponse.parse({
    activeExams: Number(active[0]?.count ?? 0),
    completedExams: Number(completed[0]?.count ?? 0),
    averageScore: Number(average[0]?.value ?? 0),
    recentResults: await Promise.all(recent.map(resultDto)),
  }));
});

router.get("/exams", async (req, res) => {
  const params = ListExamsQueryParams.parse(req.query);
  const exams = await db.select().from(examsTable).where(params.status === "all" ? undefined : eq(examsTable.status, params.status)).orderBy(asc(examsTable.startAt), asc(examsTable.id));
  res.json(await Promise.all(exams.map(examDto)));
});

router.get("/exams/:examId", async (req, res) => {
  const { examId } = GetExamParams.parse(req.params);
  const exam = (await db.select().from(examsTable).where(eq(examsTable.id, examId)).limit(1))[0];
  if (!exam) {
    res.status(404).json({ error: "Examination not found" });
    return;
  }
  const links = await db.select().from(examQuestionsTable).where(eq(examQuestionsTable.examId, exam.id)).orderBy(asc(examQuestionsTable.questionId));
  const questionIds = links.map((link) => link.questionId);
  const questions = questionIds.length ? await db.select().from(questionsTable).where(inArray(questionsTable.id, questionIds)) : [];
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  res.json(GetExamResponse.parse({
    exam: await examDto(exam),
    questions: await Promise.all(questionIds.map((id) => questionMap.get(id)).filter(Boolean).map((question) => questionDto(question!, true))),
  }));
});

router.post("/exams/:examId/attempts", async (req: AuthedRequest, res) => {
  const { examId } = StartAttemptParams.parse(req.params);
  const user = req.cbtUser!;
  const existing = await db.select().from(attemptsTable).where(and(eq(attemptsTable.examId, examId), eq(attemptsTable.userId, user.id), eq(attemptsTable.status, "in_progress"))).orderBy(desc(attemptsTable.id)).limit(1);
  if (existing[0] && new Date(existing[0].expiresAt) > new Date()) {
    res.status(201).json(await attemptDto(existing[0]));
    return;
  }
  const exam = (await db.select().from(examsTable).where(eq(examsTable.id, examId)).limit(1))[0];
  if (!exam) {
    res.status(404).json({ error: "Examination not found" });
    return;
  }
  const startedAt = new Date();
  const created = await db.insert(attemptsTable).values({
    userId: user.id,
    examId,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + exam.durationMinutes * 60_000),
    status: "in_progress",
    answers: {},
  }).returning();
  res.status(201).json(await attemptDto(created[0]!));
});

router.get("/attempts/:attemptId", async (req: AuthedRequest, res) => {
  const { attemptId } = GetAttemptParams.parse(req.params);
  const attempt = (await db.select().from(attemptsTable).where(and(eq(attemptsTable.id, attemptId), eq(attemptsTable.userId, req.cbtUser!.id))).limit(1))[0];
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found" });
    return;
  }
  res.json(await attemptDto(attempt));
});

router.patch("/attempts/:attemptId/answers", async (req: AuthedRequest, res) => {
  const { attemptId } = SaveAttemptAnswerParams.parse(req.params);
  const body = SaveAttemptAnswerBody.parse(req.body);
  const attempt = (await db.select().from(attemptsTable).where(and(eq(attemptsTable.id, attemptId), eq(attemptsTable.userId, req.cbtUser!.id))).limit(1))[0];
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found" });
    return;
  }
  if (attempt.status !== "in_progress" || new Date(attempt.expiresAt) <= new Date()) {
    res.status(409).json({ error: "This attempt is no longer active" });
    return;
  }
  const answers = { ...attempt.answers, [String(body.questionId)]: body.selectedOption };
  const updated = await db.update(attemptsTable).set({ answers }).where(eq(attemptsTable.id, attemptId)).returning();
  res.json(await attemptDto(updated[0]!));
});

router.post("/attempts/:attemptId/submit", async (req: AuthedRequest, res) => {
  const { attemptId } = SubmitAttemptParams.parse(req.params);
  const user = req.cbtUser!;
  const attempt = (await db.select().from(attemptsTable).where(and(eq(attemptsTable.id, attemptId), eq(attemptsTable.userId, user.id))).limit(1))[0];
  if (!attempt) {
    res.status(404).json({ error: "Attempt not found" });
    return;
  }
  const existing = await db.select().from(resultsTable).where(eq(resultsTable.attemptId, attemptId)).limit(1);
  if (existing[0]) {
    res.json(await resultDto(existing[0]));
    return;
  }
  const links = await db.select().from(examQuestionsTable).where(eq(examQuestionsTable.examId, attempt.examId));
  const questions = links.length ? await db.select().from(questionsTable).where(inArray(questionsTable.id, links.map((link) => link.questionId))) : [];
  const score = questions.reduce((total, question) => total + (attempt.answers[String(question.id)] === question.correctOption ? 1 : 0), 0);
  const percentage = questions.length ? Math.round((score / questions.length) * 100) : 0;
  const updated = await db.update(attemptsTable).set({ status: "submitted" }).where(eq(attemptsTable.id, attemptId)).returning();
  const created = await db.insert(resultsTable).values({
    userId: user.id,
    examId: attempt.examId,
    attemptId,
    score,
    totalQuestions: questions.length,
    percentage,
    passed: percentage >= 50,
  }).returning();
  req.log.info({ attemptId, percentage }, "CBT attempt submitted");
  void updated;
  res.json(await resultDto(created[0]!));
});

router.get("/results", async (req: AuthedRequest, res) => {
  const results = await db.select().from(resultsTable).where(eq(resultsTable.userId, req.cbtUser!.id)).orderBy(desc(resultsTable.submittedAt));
  res.json(ListResultsResponse.parse(await Promise.all(results.map(resultDto))));
});

router.use("/admin", requireAdmin);

router.patch("/admin/school-info", async (req, res) => {
  const body = UpdateSchoolInfoBody.parse(req.body);
  await ensureSchoolInfo();
  const existing = (await db.select().from(schoolInfoTable).limit(1))[0]!;
  const updated = await db.update(schoolInfoTable).set(body).where(eq(schoolInfoTable.id, existing.id)).returning();
  res.json(UpdateSchoolInfoResponse.parse(schoolDto(updated[0]!)));
});

router.get("/admin/epins", async (_req, res) => {
  const epins = await db.select().from(epinsTable).orderBy(desc(epinsTable.generatedAt));
  res.json(epins.map(epinDto));
});

router.post("/admin/epins", async (req, res) => {
  const body = GenerateEpinsBody.parse(req.body);
  const rows: Array<typeof epinsTable.$inferInsert> = [];
  for (let index = 0; index < body.quantity; index += 1) {
    const code = randomBytes(8).toString("hex").toUpperCase();
    rows.push({
      code,
      codeHash: epinHash(code),
      status: "active",
      uses: 0,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt ?? null,
    });
  }
  const created = await db.insert(epinsTable).values(rows).returning();
  res.status(201).json(GenerateEpinsResponse.parse(created.map(epinDto)));
});

router.patch("/admin/epins/:epinId", async (req, res) => {
  const { epinId } = UpdateEpinParams.parse(req.params);
  const body = UpdateEpinBody.parse(req.body);
  const updated = await db.update(epinsTable).set(body).where(eq(epinsTable.id, epinId)).returning();
  if (!updated[0]) {
    res.status(404).json({ error: "EPIN not found" });
    return;
  }
  res.json(epinDto(updated[0]));
});

router.get("/admin/summary", async (_req, res) => {
  const [students, subjects, questions, examinations, average, recent] = await Promise.all([
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "student")),
    db.select({ count: count() }).from(subjectsTable),
    db.select({ count: count() }).from(questionsTable),
    db.select({ count: count() }).from(examsTable),
    db.select({ value: sql<number | null>`avg(${resultsTable.percentage})` }).from(resultsTable),
    db.select().from(resultsTable).orderBy(desc(resultsTable.submittedAt)).limit(5),
  ]);
  res.json(GetAdminSummaryResponse.parse({
    students: Number(students[0]?.count ?? 0),
    subjects: Number(subjects[0]?.count ?? 0),
    questions: Number(questions[0]?.count ?? 0),
    examinations: Number(examinations[0]?.count ?? 0),
    averageScore: Number(average[0]?.value ?? 0),
    recentResults: await Promise.all(recent.map(resultDto)),
  }));
});

router.get("/admin/students", async (_req, res) => {
  const students = await db.select().from(usersTable).where(eq(usersTable.role, "student")).orderBy(desc(usersTable.joinedAt));
  const data = await Promise.all(students.map(async (student) => {
    const totals = await db.select({ count: count(), average: sql<number | null>`avg(${resultsTable.percentage})` }).from(resultsTable).where(eq(resultsTable.userId, student.id));
    return { id: student.id, name: student.name, email: student.email, studentNumber: student.studentNumber, examsTaken: Number(totals[0]?.count ?? 0), averageScore: Number(totals[0]?.average ?? 0), joinedAt: student.joinedAt };
  }));
  res.json(ListStudentsResponse.parse(data));
});

router.get("/admin/subjects", async (_req, res) => {
  const subjects = await db.select().from(subjectsTable).orderBy(asc(subjectsTable.name));
  res.json(ListSubjectsResponse.parse(await Promise.all(subjects.map(subjectDto))));
});

router.post("/admin/subjects", async (req, res) => {
  const body = CreateSubjectBody.parse(req.body);
  const created = await db.insert(subjectsTable).values(body).returning();
  res.status(201).json(await subjectDto(created[0]!));
});

router.patch("/admin/subjects/:subjectId", async (req, res) => {
  const { subjectId } = UpdateSubjectParams.parse(req.params);
  const body = UpdateSubjectBody.parse(req.body);
  const updated = await db.update(subjectsTable).set(body).where(eq(subjectsTable.id, subjectId)).returning();
  if (!updated[0]) {
    res.status(404).json({ error: "Subject not found" });
    return;
  }
  res.json(await subjectDto(updated[0]));
});

router.delete("/admin/subjects/:subjectId", async (req, res) => {
  const { subjectId } = UpdateSubjectParams.parse(req.params);
  await db.delete(subjectsTable).where(eq(subjectsTable.id, subjectId));
  res.status(204).send();
});

router.get("/admin/questions", async (req, res) => {
  const { subjectId } = ListQuestionsQueryParams.parse(req.query);
  const questions = await db.select().from(questionsTable).where(subjectId ? eq(questionsTable.subjectId, subjectId) : undefined).orderBy(desc(questionsTable.id));
  res.json(await Promise.all(questions.map((question) => questionDto(question))));
});

router.post("/admin/questions", async (req, res) => {
  const body = CreateQuestionBody.parse(req.body);
  const created = await db.insert(questionsTable).values(body).returning();
  res.status(201).json(await questionDto(created[0]!));
});

router.patch("/admin/questions/:questionId", async (req, res) => {
  const { questionId } = UpdateQuestionParams.parse(req.params);
  const body = UpdateQuestionBody.parse(req.body);
  const updated = await db.update(questionsTable).set(body).where(eq(questionsTable.id, questionId)).returning();
  if (!updated[0]) {
    res.status(404).json({ error: "Question not found" });
    return;
  }
  res.json(await questionDto(updated[0]));
});

router.delete("/admin/questions/:questionId", async (req, res) => {
  const { questionId } = UpdateQuestionParams.parse(req.params);
  await db.delete(questionsTable).where(eq(questionsTable.id, questionId));
  res.status(204).send();
});

router.get("/admin/exams", async (_req, res) => {
  const exams = await db.select().from(examsTable).orderBy(desc(examsTable.id));
  res.json(ListAdminExamsResponse.parse(await Promise.all(exams.map(examDto))));
});

router.post("/admin/exams", async (req, res) => {
  const body = CreateExamBody.parse(req.body);
  const { questionIds, ...examBody } = body;
  const created = await db.insert(examsTable).values(examBody).returning();
  const ids = questionIds?.length ? questionIds : (await db.select({ id: questionsTable.id }).from(questionsTable).where(eq(questionsTable.subjectId, body.subjectId))).map((question) => question.id);
  if (ids.length) await db.insert(examQuestionsTable).values(ids.map((questionId) => ({ examId: created[0]!.id, questionId }))).onConflictDoNothing();
  res.status(201).json(await examDto(created[0]!));
});

router.patch("/admin/exams/:examId", async (req, res) => {
  const { examId } = UpdateExamParams.parse(req.params);
  const body = UpdateExamBody.parse(req.body);
  const { questionIds, ...examBody } = body;
  const updated = await db.update(examsTable).set(examBody).where(eq(examsTable.id, examId)).returning();
  if (!updated[0]) {
    res.status(404).json({ error: "Examination not found" });
    return;
  }
  if (questionIds) {
    await db.delete(examQuestionsTable).where(eq(examQuestionsTable.examId, examId));
    if (questionIds.length) await db.insert(examQuestionsTable).values(questionIds.map((questionId) => ({ examId, questionId }))).onConflictDoNothing();
  }
  res.json(await examDto(updated[0]));
});

router.delete("/admin/exams/:examId", async (req, res) => {
  const { examId } = UpdateExamParams.parse(req.params);
  await db.delete(examsTable).where(eq(examsTable.id, examId));
  res.status(204).send();
});

router.get("/admin/results", async (_req, res) => {
  const results = await db.select().from(resultsTable).orderBy(desc(resultsTable.submittedAt));
  res.json(ListAdminResultsResponse.parse(await Promise.all(results.map(resultDto))));
});

export default router;