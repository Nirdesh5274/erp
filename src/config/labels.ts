export type InstitutionType = "college" | "school";

export const LABELS = {
  college: {
    class_entity: "Department",
    section_entity: "Slot / Batch",
    subject_entity: "Course / Paper",
    term_entity: "Semester",
    hod_role: "HOD",
    faculty_role: "Faculty",
    period_entity: "Lecture",
    promote_action: "Semester Promote",
  },
  school: {
    class_entity: "Class",
    section_entity: "Section",
    subject_entity: "Subject",
    term_entity: "Term",
    hod_role: "Principal",
    faculty_role: "Teacher",
    period_entity: "Period",
    promote_action: "Class Promote",
  },
} as const;

export type LabelSet = (typeof LABELS)[InstitutionType];
