import { apiError, apiSuccess } from "@/lib/api";
import { ensureRole, getRequestContext } from "@/lib/requestContext";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recalcStudentFeeTotals } from "@/lib/feeManagement";

interface StudentRow {
  id: string;
  name: string;
  email: string;
  admission_id: string | null;
  slot_id: string | null;
  current_semester?: number | null;
}

interface StudentFeeRow {
  id: string;
  student_id: string;
  slot_id: string | null;
  fee_structure_id: string | null;
  base_total: number | string;
  discount_total: number | string;
  fine_total: number | string;
  extra_total: number | string;
  grand_total: number | string;
  paid_total: number | string;
  due_total: number | string;
  status: string;
  due_date: string | null;
  generated_at: string;
}

interface FeeStructureMetaRow {
  id: string;
  semester: number | string | null;
  is_active: boolean | null;
  updated_at?: string;
}

interface LegacyFeeRow {
  id: string;
  student_id: string;
  amount: number | string;
  paid_amount: number | string;
  due_amount: number | string;
  status: string;
  generated_at: string;
}

function normalizeLegacyFee(fee: LegacyFeeRow) {
  const amount = Number(fee.amount ?? 0);
  const paid = Number(fee.paid_amount ?? 0);
  const status = String(fee.status ?? "").toLowerCase();

  const normalizedPaid = status === "paid" ? Math.max(paid, amount) : paid;
  const normalizedDue = status === "paid" ? 0 : Math.max(amount - normalizedPaid, 0);

  return {
    amount,
    paid: normalizedPaid,
    due: normalizedDue,
    status: fee.status,
  };
}

function isMissingDescriptionColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("fee_structures.description") || msg.includes("column description does not exist");
}

function isMissingCurrentSemesterColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("current_semester") && (msg.includes("column") || msg.includes("schema cache"));
}

function isMissingSemesterColumn(message: string | undefined) {
  const msg = (message ?? "").toLowerCase();
  return msg.includes("semester") && (msg.includes("column") || msg.includes("schema cache"));
}

export async function GET(request: Request) {
  try {
    const ctx = await getRequestContext();
    if (!ensureRole(ctx.role, ["Admin"])) return apiError("Forbidden", 403);
    if (!ctx.collegeId) return apiError("Missing college context", 400);

    const url = new URL(request.url);
    const slotId = url.searchParams.get("slotId");
    const studentId = url.searchParams.get("studentId");

    if (!slotId) return apiError("slotId is required", 400);

    const supabase = getSupabaseAdmin();

    const { data: slot, error: slotError } = await supabase
      .from("slots")
      .select("id,course")
      .eq("id", slotId)
      .eq("college_id", ctx.collegeId)
      .single();

    if (slotError || !slot) return apiError("Slot not found", 404);

    const { data: studentsWithSemester, error: studentsWithSemesterError } = await supabase
      .from("students")
      .select("id,name,email,admission_id,slot_id,current_semester")
      .eq("college_id", ctx.collegeId)
      .eq("slot_id", slotId)
      .order("name", { ascending: true });

    let students = (studentsWithSemester ?? []) as StudentRow[];
    if (studentsWithSemesterError) {
      if (!isMissingCurrentSemesterColumn(studentsWithSemesterError.message)) return apiError(studentsWithSemesterError.message, 500);

      const fallbackStudents = await supabase
        .from("students")
        .select("id,name,email,admission_id,slot_id")
        .eq("college_id", ctx.collegeId)
        .eq("slot_id", slotId)
        .order("name", { ascending: true });

      if (fallbackStudents.error) return apiError(fallbackStudents.error.message, 500);
      students = ((fallbackStudents.data ?? []) as StudentRow[]).map((row) => ({ ...row, current_semester: null }));
    }

    const studentIds = (students ?? []).map((row) => row.id as string);

    let fees: StudentFeeRow[] = [];
    let legacyFees: LegacyFeeRow[] = [];
    if (studentIds.length > 0) {
      let feesQuery = supabase
        .from("student_fees")
        .select("id,student_id,slot_id,fee_structure_id,base_total,discount_total,fine_total,extra_total,grand_total,paid_total,due_total,status,due_date,generated_at")
        .eq("college_id", ctx.collegeId)
        .eq("slot_id", slotId)
        .in("student_id", studentIds)
        .order("generated_at", { ascending: false });

      if (studentId) feesQuery = feesQuery.eq("student_id", studentId);

      const { data: feeRows, error: feesError } = await feesQuery;
      if (feesError) return apiError(feesError.message, 500);
      fees = (feeRows ?? []) as StudentFeeRow[];

      let legacyFeesQuery = supabase
        .from("fees")
        .select("id,student_id,amount,paid_amount,due_amount,status,generated_at")
        .eq("college_id", ctx.collegeId)
        .in("student_id", studentIds)
        .order("generated_at", { ascending: false });

      if (studentId) legacyFeesQuery = legacyFeesQuery.eq("student_id", studentId);

      const { data: legacyFeeRows, error: legacyFeesError } = await legacyFeesQuery;
      if (legacyFeesError) return apiError(legacyFeesError.message, 500);
      legacyFees = (legacyFeeRows ?? []) as LegacyFeeRow[];

      // Auto-heal: if a student has current semester + active structure for that semester
      // but no student_fee exists, create it so dues become visible immediately.
      const semesterValues = Array.from(
        new Set(
          (students ?? [])
            .map((student) => Number(student.current_semester ?? 0))
            .filter((semester) => semester > 0),
        ),
      );

      if (semesterValues.length > 0) {
        const { data: activeStructures, error: activeStructuresError } = await supabase
          .from("fee_structures")
          .select("id,semester,name")
          .eq("college_id", ctx.collegeId)
          .eq("slot_id", slotId)
          .eq("is_active", true)
          .in("semester", semesterValues)
          .order("updated_at", { ascending: false });

        if (activeStructuresError && !isMissingSemesterColumn(activeStructuresError.message)) {
          return apiError(activeStructuresError.message, 500);
        }

        if (!activeStructuresError) {
          const structureBySemester = new Map<number, { id: string; name: string }>();
          for (const row of activeStructures ?? []) {
            const semester = Number(row.semester ?? 0);
            if (semester <= 0) continue;
            if (!structureBySemester.has(semester)) {
              structureBySemester.set(semester, {
                id: row.id as string,
                name: row.name as string,
              });
            }
          }

          const existingFeeKey = new Set(
            fees.map((fee) => `${fee.student_id}:${fee.fee_structure_id ?? ""}`),
          );
          const componentCache = new Map<string, Array<{ id: string; component_name: string; default_amount: number | string }>>();

          let healed = false;

          for (const student of students ?? []) {
            const semester = Number(student.current_semester ?? 0);
            if (semester <= 0) continue;

            const structure = structureBySemester.get(semester);
            if (!structure) continue;

            const key = `${student.id as string}:${structure.id}`;
            if (existingFeeKey.has(key)) continue;

            let structureComponents = componentCache.get(structure.id);
            if (!structureComponents) {
              const { data: loadedComponents, error: loadedComponentsError } = await supabase
                .from("fee_components")
                .select("id,component_name,default_amount")
                .eq("fee_structure_id", structure.id)
                .order("sort_order", { ascending: true });

              if (loadedComponentsError) return apiError(loadedComponentsError.message, 500);
              structureComponents = (loadedComponents ?? []) as Array<{ id: string; component_name: string; default_amount: number | string }>;
              componentCache.set(structure.id, structureComponents);
            }

            if ((structureComponents ?? []).length === 0) continue;

            const { data: createdFee, error: createdFeeError } = await supabase
              .from("student_fees")
              .insert({
                college_id: ctx.collegeId,
                student_id: student.id,
                admission_id: student.admission_id,
                slot_id: slotId,
                fee_structure_id: structure.id,
                notes: `Auto-generated for Semester ${semester}`,
              })
              .select("id")
              .single();

            if (createdFeeError) return apiError(createdFeeError.message, 500);

            const feeId = createdFee.id as string;
            const itemPayload = (structureComponents ?? []).map((component) => ({
              student_fee_id: feeId,
              college_id: ctx.collegeId,
              source_component_id: component.id,
              item_type: "component",
              label: component.component_name,
              amount: Number(component.default_amount ?? 0),
              quantity: 1,
              metadata: {
                source: "auto_heal_current_semester",
                semester,
                structureName: structure.name,
              },
            }));

            const { error: insertItemsError } = await supabase.from("student_fee_items").insert(itemPayload);
            if (insertItemsError) return apiError(insertItemsError.message, 500);

            await recalcStudentFeeTotals(supabase, feeId);

            healed = true;
            existingFeeKey.add(key);
          }

          if (healed) {
            let refreshFeesQuery = supabase
              .from("student_fees")
              .select("id,student_id,slot_id,fee_structure_id,base_total,discount_total,fine_total,extra_total,grand_total,paid_total,due_total,status,due_date,generated_at")
              .eq("college_id", ctx.collegeId)
              .eq("slot_id", slotId)
              .in("student_id", studentIds)
              .order("generated_at", { ascending: false });

            if (studentId) refreshFeesQuery = refreshFeesQuery.eq("student_id", studentId);

            const { data: refreshedFees, error: refreshedFeesError } = await refreshFeesQuery;
            if (refreshedFeesError) return apiError(refreshedFeesError.message, 500);
            fees = (refreshedFees ?? []) as StudentFeeRow[];
          }
        }
      }
    }

    const studentSemesterById = new Map<string, number>();
    for (const student of students ?? []) {
      studentSemesterById.set(student.id as string, Number(student.current_semester ?? 1));
    }

    let structureMetaById = new Map<string, { semester: number | null; isActive: boolean; updatedAt: string | null }>();
    const feeStructureIds = Array.from(new Set(fees.map((fee) => fee.fee_structure_id).filter(Boolean) as string[]));
    if (feeStructureIds.length > 0) {
      const { data: structureMetaRows, error: structureMetaError } = await supabase
        .from("fee_structures")
        .select("id,semester,is_active,updated_at")
        .in("id", feeStructureIds);

      if (structureMetaError && !isMissingSemesterColumn(structureMetaError.message)) {
        return apiError(structureMetaError.message, 500);
      }

      if (!structureMetaError) {
        structureMetaById = new Map(
          ((structureMetaRows ?? []) as FeeStructureMetaRow[]).map((row) => [
            row.id,
            {
              semester: row.semester === null ? null : Number(row.semester),
              isActive: Boolean(row.is_active),
              updatedAt: row.updated_at ? String(row.updated_at) : null,
            },
          ]),
        );
      }
    }

    const effectiveActiveStructureBySemester = new Map<number, string>();
    for (const [structureId, meta] of structureMetaById.entries()) {
      if (!meta.isActive) continue;
      if (meta.semester === null) continue;

      const existingId = effectiveActiveStructureBySemester.get(meta.semester);
      if (!existingId) {
        effectiveActiveStructureBySemester.set(meta.semester, structureId);
        continue;
      }

      const existingMeta = structureMetaById.get(existingId);
      const existingTime = existingMeta?.updatedAt ? new Date(existingMeta.updatedAt).getTime() : 0;
      const currentTime = meta.updatedAt ? new Date(meta.updatedAt).getTime() : 0;
      if (currentTime >= existingTime) {
        effectiveActiveStructureBySemester.set(meta.semester, structureId);
      }
    }

    const dedupedFeesByStudentAndStructure = new Map<string, StudentFeeRow>();
    for (const fee of fees) {
      const key = `${fee.student_id}:${fee.fee_structure_id ?? "no_structure"}`;
      const existing = dedupedFeesByStudentAndStructure.get(key);
      if (!existing) {
        dedupedFeesByStudentAndStructure.set(key, fee);
        continue;
      }

      const existingTime = new Date(existing.generated_at).getTime();
      const currentTime = new Date(fee.generated_at).getTime();
      if (currentTime >= existingTime) {
        dedupedFeesByStudentAndStructure.set(key, fee);
      }
    }

    fees = Array.from(dedupedFeesByStudentAndStructure.values());

    const shouldIncludeFeeForStudent = (fee: StudentFeeRow) => {
      const structureId = fee.fee_structure_id;
      if (!structureId) return true;

      const structureMeta = structureMetaById.get(structureId);
      if (!structureMeta) return true;

      const currentSemester = studentSemesterById.get(fee.student_id) ?? 1;
      const structureSemester = structureMeta.semester;
      const effectiveStructureId = effectiveActiveStructureBySemester.get(currentSemester);

      if (!structureMeta.isActive) return false;
      if (structureSemester === null) return true;
      if (structureSemester !== currentSemester) return false;
      if (effectiveStructureId && structureId !== effectiveStructureId) return false;

      return true;
    };

    const latestLegacyFeeByStudent = new Map<string, LegacyFeeRow>();
    for (const fee of legacyFees) {
      const existing = latestLegacyFeeByStudent.get(fee.student_id);
      if (!existing) {
        latestLegacyFeeByStudent.set(fee.student_id, fee);
        continue;
      }

      const existingTime = new Date(existing.generated_at).getTime();
      const currentTime = new Date(fee.generated_at).getTime();
      if (currentTime >= existingTime) {
        latestLegacyFeeByStudent.set(fee.student_id, fee);
      }
    }

    legacyFees = Array.from(latestLegacyFeeByStudent.values());

    const summaryByStudent = new Map<string, { totalDue: number; totalPaid: number; feesCount: number }>();
    for (const fee of fees) {
      if (!shouldIncludeFeeForStudent(fee)) continue;
      const key = fee.student_id;
      const current = summaryByStudent.get(key) ?? { totalDue: 0, totalPaid: 0, feesCount: 0 };
      current.totalDue += Number(fee.due_total ?? 0);
      current.totalPaid += Number(fee.paid_total ?? 0);
      current.feesCount += 1;
      summaryByStudent.set(key, current);
    }

    for (const fee of legacyFees) {
      const normalized = normalizeLegacyFee(fee);
      const key = fee.student_id;
      const current = summaryByStudent.get(key) ?? { totalDue: 0, totalPaid: 0, feesCount: 0 };
      current.totalDue += normalized.due;
      current.totalPaid += normalized.paid;
      current.feesCount += 1;
      summaryByStudent.set(key, current);
    }

    const studentSummaries = (students ?? []).map((student) => {
      const summary = summaryByStudent.get(student.id as string) ?? { totalDue: 0, totalPaid: 0, feesCount: 0 };
      return {
        id: student.id,
        name: student.name,
        email: student.email,
        admissionId: student.admission_id,
        currentSemester: student.current_semester ?? null,
        totalDue: summary.totalDue,
        totalPaid: summary.totalPaid,
        feesCount: summary.feesCount,
      };
    });

    if (!studentId) {
      return apiSuccess({
        slot: { id: slot.id, course: slot.course },
        students: studentSummaries,
      });
    }

    const selectedStudent = (students ?? []).find((row) => row.id === studentId) as StudentRow | undefined;
    if (!selectedStudent) return apiError("Student not found in selected slot", 404);

    const selectedFees = fees.filter((fee) => fee.student_id === selectedStudent.id && shouldIncludeFeeForStudent(fee));

    const structureIds = Array.from(new Set(selectedFees.map((fee) => fee.fee_structure_id).filter(Boolean) as string[]));
    const feeIds = selectedFees.map((fee) => fee.id);

    const [structuresRes, itemsRes, paymentsRes, receiptsRes] = await Promise.all([
      structureIds.length > 0
        ? supabase
            .from("fee_structures")
            .select("id,name,description,academic_year")
            .in("id", structureIds)
        : Promise.resolve({ data: [], error: null }),
      feeIds.length > 0
        ? supabase
            .from("student_fee_items")
            .select("id,student_fee_id,item_type,label,amount,quantity,metadata,created_at")
            .in("student_fee_id", feeIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      feeIds.length > 0
        ? supabase
            .from("payments")
            .select("id,student_fee_id,amount,payment_mode,transaction_id,receipt_number,paid_at")
            .in("student_fee_id", feeIds)
            .order("paid_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      feeIds.length > 0
        ? supabase
            .from("receipts")
            .select("id,payment_id,student_fee_id,file_url,storage_path,payload,created_at")
            .in("student_fee_id", feeIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    let structuresData = structuresRes.data ?? [];
    let structuresError = structuresRes.error;

    if (structuresError && isMissingDescriptionColumn(structuresError.message)) {
      const fallbackStructures = structureIds.length > 0
        ? await supabase
            .from("fee_structures")
            .select("id,name,academic_year")
            .in("id", structureIds)
        : { data: [], error: null };

      if (fallbackStructures.error) return apiError(fallbackStructures.error.message, 500);
      structuresData = (fallbackStructures.data ?? []).map((row) => ({ ...row, description: null }));
      structuresError = null;
    }

    if (structuresError) return apiError(structuresError.message, 500);
    if (itemsRes.error) return apiError(itemsRes.error.message, 500);
    if (paymentsRes.error) return apiError(paymentsRes.error.message, 500);
    if (receiptsRes.error) return apiError(receiptsRes.error.message, 500);

    const structureById = new Map(structuresData.map((row) => [row.id as string, row]));

    const feeDetails = selectedFees.map((fee) => {
      const structure = fee.fee_structure_id ? structureById.get(fee.fee_structure_id) : null;
      return {
        id: fee.id,
        studentId: fee.student_id,
        structureId: fee.fee_structure_id,
        structureName: structure?.name ?? "Fee Structure",
        structureDescription: structure?.description ?? null,
        academicYear: structure?.academic_year ?? null,
        baseTotal: Number(fee.base_total ?? 0),
        discountTotal: Number(fee.discount_total ?? 0),
        fineTotal: Number(fee.fine_total ?? 0),
        extraTotal: Number(fee.extra_total ?? 0),
        grandTotal: Number(fee.grand_total ?? 0),
        paidTotal: Number(fee.paid_total ?? 0),
        dueTotal: Number(fee.due_total ?? 0),
        status: fee.status,
        dueDate: fee.due_date,
        generatedAt: fee.generated_at,
      };
    });

    return apiSuccess({
      slot: { id: slot.id, course: slot.course },
      students: studentSummaries,
      selectedStudent: {
        id: selectedStudent.id,
        name: selectedStudent.name,
        email: selectedStudent.email,
        admissionId: selectedStudent.admission_id,
        currentSemester: selectedStudent.current_semester ?? null,
      },
      fees: feeDetails,
      legacyFees: legacyFees
        .filter((fee) => fee.student_id === selectedStudent.id)
        .map((fee) => {
          const normalized = normalizeLegacyFee(fee);
          return {
          id: fee.id,
          amount: normalized.amount,
          paidAmount: normalized.paid,
          dueAmount: normalized.due,
          status: normalized.status,
          generatedAt: fee.generated_at,
          };
        }),
      feeItems: itemsRes.data ?? [],
      payments: paymentsRes.data ?? [],
      receipts: receiptsRes.data ?? [],
    });
  } catch (error) {
    return apiError("Unable to load student fees", 500, String(error));
  }
}
