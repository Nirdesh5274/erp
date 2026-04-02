import { z } from "zod";

export const schoolDaySchema = z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

export const timetableCreateSchema = z.object({
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid().optional().nullable(),
  teacherId: z.string().uuid(),
  day: schoolDaySchema,
  periodNumber: z.number().int().min(1).max(12),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  roomId: z.string().uuid().optional().nullable(),
});

export const sectionCreateSchema = z.object({
  classId: z.string().uuid(),
  name: z.string().min(1).max(50),
  totalSeats: z.number().int().positive().max(500).default(60),
  assignedTeacherId: z.string().uuid().optional().nullable(),
  roomId: z.string().uuid().optional().nullable(),
  academicYear: z.string().max(20).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
