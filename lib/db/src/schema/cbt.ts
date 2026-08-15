import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const usersTable = pgTable("cbt_users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  studentNumber: text("student_number").notNull().default("PENDING"),
  role: text("role").notNull().default("student"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schoolInfoTable = pgTable("cbt_school_info", {
  id: serial("id").primaryKey(),
  schoolName: text("school_name").notNull().default("Desired Kiddies College"),
  proprietor: text("proprietor").notNull().default("Mr. Sunday Bibitayo Ojeleke"),
  headmistress: text("headmistress").notNull().default("Mrs. Omolara Ojeleke"),
  phonePrimary: text("phone_primary").notNull().default("08038020039"),
  phoneSecondary: text("phone_secondary").notNull().default("08137606650"),
  email: text("email").notNull().default("desiredkiddiescollege@gmail.com"),
});

export const subjectsTable = pgTable("cbt_subjects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
});

export const questionsTable = pgTable("cbt_questions", {
  id: serial("id").primaryKey(),
  subjectId: integer("subject_id").notNull().references(() => subjectsTable.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  options: jsonb("options").$type<string[]>().notNull(),
  correctOption: integer("correct_option").notNull(),
  difficulty: text("difficulty").notNull().default("medium"),
});

export const examsTable = pgTable("cbt_exams", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  subjectId: integer("subject_id").notNull().references(() => subjectsTable.id, { onDelete: "cascade" }),
  durationMinutes: integer("duration_minutes").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }),
  status: text("status").notNull().default("upcoming"),
  color: text("color").notNull().default("indigo"),
});

export const examQuestionsTable = pgTable(
  "cbt_exam_questions",
  {
    examId: integer("exam_id").notNull().references(() => examsTable.id, { onDelete: "cascade" }),
    questionId: integer("question_id").notNull().references(() => questionsTable.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.examId, table.questionId)],
);

export const attemptsTable = pgTable("cbt_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  examId: integer("exam_id").notNull().references(() => examsTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("in_progress"),
  answers: jsonb("answers").$type<Record<string, number>>().notNull().default({}),
});

export const resultsTable = pgTable("cbt_results", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  examId: integer("exam_id").notNull().references(() => examsTable.id, { onDelete: "cascade" }),
  attemptId: integer("attempt_id").notNull().references(() => attemptsTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  totalQuestions: integer("total_questions").notNull(),
  percentage: integer("percentage").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  passed: boolean("passed").notNull(),
});

export const epinsTable = pgTable("cbt_epins", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  codeHash: text("code_hash").notNull().unique(),
  status: text("status").notNull().default("active"),
  uses: integer("uses").notNull().default(0),
  maxUses: integer("max_uses").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, joinedAt: true });
export const insertSubjectSchema = createInsertSchema(subjectsTable).omit({ id: true });
export const insertQuestionSchema = createInsertSchema(questionsTable).omit({ id: true });
export const insertExamSchema = createInsertSchema(examsTable).omit({ id: true });
export const insertAttemptSchema = createInsertSchema(attemptsTable).omit({ id: true, startedAt: true });
export const insertResultSchema = createInsertSchema(resultsTable).omit({ id: true, submittedAt: true });
export const insertSchoolInfoSchema = createInsertSchema(schoolInfoTable).omit({ id: true });
export const insertEpinSchema = createInsertSchema(epinsTable).omit({ id: true, generatedAt: true, lastUsedAt: true });

export type User = typeof usersTable.$inferSelect;
export type Subject = typeof subjectsTable.$inferSelect;
export type Question = typeof questionsTable.$inferSelect;
export type Exam = typeof examsTable.$inferSelect;
export type Attempt = typeof attemptsTable.$inferSelect;
export type Result = typeof resultsTable.$inferSelect;
export type SchoolInfo = typeof schoolInfoTable.$inferSelect;
export type Epin = typeof epinsTable.$inferSelect;
export type NewSubject = z.infer<typeof insertSubjectSchema>;
export type NewQuestion = z.infer<typeof insertQuestionSchema>;
export type NewExam = z.infer<typeof insertExamSchema>;