"use client";

import { FormEvent, DragEvent, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { SectionCard } from "@/components/ui/SectionCard";
import { PageSkeleton } from "@/components/ui/skeletons";
import { apiFetch } from "@/lib/clientApi";
import { useRoomMonitoring } from "@/hooks/useRoomMonitoring";

interface ScheduleResponse {
  window: { from: string; to: string };
  departments: Array<{ id: string; name: string }>;
  rooms: Array<{ id: string; name: string; department_id?: string }>;
  faculties: Array<{ id: string; name: string; department_id: string }>;
  subjects: Array<{ id: string; name: string; department_id: string }>;
  facultySubjectMap: Record<string, string[]>;
  lectures: Array<{
    id: string;
    departmentId: string;
    departmentName: string;
    subjectId: string | null;
    subjectName: string;
    facultyId: string;
    facultyName: string;
    substituteFacultyId: string | null;
    substituteFacultyName: string;
    isSubstitute: boolean;
    roomId: string;
    roomName: string;
    startsAt: string;
    endsAt: string;
    attendanceLocked: boolean;
    attendanceLockReason: string | null;
    attendancePercent: number | null;
    presentCount: number;
    totalMarked: number;
    liveStatus: string;
    overrideReason: string | null;
    alerts: number;
    isOverdue: boolean;
    isStartingSoon: boolean;
    conflicts: string[];
  }>;
}

interface DragCard {
  facultyId: string;
  departmentId: string;
  facultyName: string;
  subjectId: string | null;
  subjectName: string;
}

function toLocalDatePart(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function HodSchedulePage() {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [departmentId, setDepartmentId] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [substituteFacultyId, setSubstituteFacultyId] = useState("");

  const [selectedLectureId, setSelectedLectureId] = useState("");
  const [moveRoomId, setMoveRoomId] = useState("");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");
  const [substituteByLecture, setSubstituteByLecture] = useState<Record<string, string>>({});
  const [submittingSubstitute, setSubmittingSubstitute] = useState<string | null>(null);
  const [smartDurationMinutes, setSmartDurationMinutes] = useState(60);

  const [conflictNote, setConflictNote] = useState<string | null>(null);
  const [suggestedRooms, setSuggestedRooms] = useState<string[]>([]);
  const [suggestedSlots, setSuggestedSlots] = useState<Array<{ label: string; startsAt: string; endsAt: string }>>([]);
  const [showPastLectures, setShowPastLectures] = useState(false);
  const [plannerRoomMode, setPlannerRoomMode] = useState<"auto" | "manual">("auto");
  const [plannerSlotMinutes, setPlannerSlotMinutes] = useState(60);

  const { rooms: liveRooms, occupiedCount } = useRoomMonitoring();

  const liveStatusByRoom = useMemo(() => {
    const map = new Map<string, string>();
    for (const room of liveRooms) {
      map.set(room.roomId, room.status);
    }
    return map;
  }, [liveRooms]);

  const mergedLectures = useMemo(() => {
    if (!data) return [];
    return data.lectures.map((lecture) => ({
      ...lecture,
      liveStatus: liveStatusByRoom.get(lecture.roomId) ?? lecture.liveStatus,
    }));
  }, [data, liveStatusByRoom]);

  const visibleLectures = useMemo(() => {
    if (showPastLectures) return mergedLectures;
    const now = Date.now();
    return mergedLectures.filter((lecture) => new Date(lecture.endsAt).getTime() >= now);
  }, [mergedLectures, showPastLectures]);

  const hasWindow = Boolean(startsAt && endsAt && new Date(endsAt) > new Date(startsAt));

  const filteredSubjects = useMemo(() => {
    if (!data) return [];
    if (!facultyId) return data.subjects;
    const mappedNames = data.facultySubjectMap?.[facultyId] ?? [];
    if (mappedNames.length === 0) return data.subjects;
    return data.subjects.filter((subject) => mappedNames.includes(subject.name));
  }, [data, facultyId]);

  const substituteCandidates = useMemo(() => {
    if (!data) return [];
    const selectedFacultyDepartmentId = data.faculties.find((faculty) => faculty.id === facultyId)?.department_id;
    const baseList = data.faculties.filter(
      (faculty) => faculty.id !== facultyId && (!selectedFacultyDepartmentId || faculty.department_id === selectedFacultyDepartmentId),
    );
    if (!hasWindow) return baseList;

    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();
    const overlaps = (lectureStart: string, lectureEnd: string) => {
      const lStart = new Date(lectureStart).getTime();
      const lEnd = new Date(lectureEnd).getTime();
      return lStart < endMs && lEnd > startMs;
    };

    return baseList.filter((faculty) =>
      !mergedLectures.some(
        (lecture) =>
          overlaps(lecture.startsAt, lecture.endsAt) &&
          (lecture.facultyId === faculty.id || lecture.substituteFacultyId === faculty.id),
      )
    );
  }, [data, facultyId, hasWindow, startsAt, endsAt, mergedLectures]);

  const availableFaculties = useMemo(() => {
    if (!data || !hasWindow) return [];
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();
    const overlaps = (lectureStart: string, lectureEnd: string) => {
      const lStart = new Date(lectureStart).getTime();
      const lEnd = new Date(lectureEnd).getTime();
      return lStart < endMs && lEnd > startMs;
    };
    return data.faculties.filter((faculty) => {
      return !mergedLectures.some(
        (lecture) =>
          overlaps(lecture.startsAt, lecture.endsAt) &&
          (lecture.facultyId === faculty.id || lecture.substituteFacultyId === faculty.id),
      );
    });
  }, [data, hasWindow, startsAt, endsAt, mergedLectures]);

  const availableRooms = useMemo(() => {
    if (!data || !hasWindow) return [];
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();
    const overlaps = (lectureStart: string, lectureEnd: string) => {
      const lStart = new Date(lectureStart).getTime();
      const lEnd = new Date(lectureEnd).getTime();
      return lStart < endMs && lEnd > startMs;
    };
    return data.rooms.filter((room) => {
      return !mergedLectures.some((lecture) => lecture.roomId === room.id && overlaps(lecture.startsAt, lecture.endsAt));
    });
  }, [data, hasWindow, startsAt, endsAt, mergedLectures]);

  const smartSuggest = useMemo(() => {
    const bestFaculty = availableFaculties[0];
    const bestRoom = availableRooms[0];
    const now = new Date();
    const smartStart = new Date(now.getTime() + 5 * 60 * 1000);
    const smartEnd = new Date(smartStart.getTime() + smartDurationMinutes * 60 * 1000);
    return {
      facultyId: bestFaculty?.id ?? "",
      roomId: bestRoom?.id ?? "",
      start: smartStart.toISOString().slice(0, 16),
      end: smartEnd.toISOString().slice(0, 16),
    };
  }, [availableFaculties, availableRooms, smartDurationMinutes]);

  useEffect(() => {
    if (!data || !facultyId) return;
    const mappedNames = data.facultySubjectMap?.[facultyId] ?? [];
    if (mappedNames.length === 0) return;
    const candidateSubjects = data.subjects.filter((subject) => mappedNames.includes(subject.name));
    if (candidateSubjects.length === 0) return;
    if (!candidateSubjects.some((subject) => subject.id === subjectId)) {
      setSubjectId(candidateSubjects[0].id);
    }
  }, [data, facultyId, subjectId]);

  const weekStart = useMemo(() => {
    const now = new Date();
    const requested = filterFrom ? new Date(filterFrom) : now;
    const base = requested.getTime() < now.getTime() ? now : requested;
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    return start;
  }, [filterFrom]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const slotWindows = useMemo(() => {
    const windows: Array<{ label: string; start: string; end: string }> = [];
    const dayStartMinutes = 8 * 60;
    const dayEndMinutes = 18 * 60;
    const safeStep = Math.max(30, plannerSlotMinutes);

    for (let cursor = dayStartMinutes; cursor < dayEndMinutes; cursor += safeStep) {
      const endMinutes = Math.min(cursor + safeStep, dayEndMinutes);
      const sh = String(Math.floor(cursor / 60)).padStart(2, "0");
      const sm = String(cursor % 60).padStart(2, "0");
      const eh = String(Math.floor(endMinutes / 60)).padStart(2, "0");
      const em = String(endMinutes % 60).padStart(2, "0");
      windows.push({
        label: `${sh}:${sm}-${eh}:${em}`,
        start: `${sh}:${sm}`,
        end: `${eh}:${em}`,
      });
    }

    return windows;
  }, [plannerSlotMinutes]);

  const dragCards = useMemo<DragCard[]>(() => {
    if (!data) return [];
    return data.faculties.slice(0, 12).map((fac) => {
      const subj = data.subjects.find((s) => s.department_id === fac.department_id) ?? data.subjects[0];
      return {
        facultyId: fac.id,
        departmentId: fac.department_id,
        facultyName: fac.name,
        subjectId: subj?.id ?? null,
        subjectName: subj?.name ?? "General",
      };
    });
  }, [data]);

  const plannerRoomChoices = useMemo(() => {
    if (!data) return [];
    if (!departmentId) return data.rooms;
    const filtered = data.rooms.filter((room) => !room.department_id || room.department_id === departmentId);
    return filtered.length > 0 ? filtered : data.rooms;
  }, [data, departmentId]);

  const lecturesByCell = useMemo(() => {
    const map = new Map<string, ScheduleResponse["lectures"]>();
    for (const lec of visibleLectures) {
      const dt = new Date(lec.startsAt);
      const dayKey = dt.toDateString();
      const lectureMinutes = dt.getHours() * 60 + dt.getMinutes();
      const slot = slotWindows.find((s) => {
        const [h, m] = s.start.split(":");
        const [eh, em] = s.end.split(":");
        const startMinutes = Number(h) * 60 + Number(m);
        const endMinutes = Number(eh) * 60 + Number(em);
        return lectureMinutes >= startMinutes && lectureMinutes < endMinutes;
      });
      if (!slot) continue;
      const key = `${dayKey}-${slot.label}`;
      map.set(key, [...(map.get(key) ?? []), lec]);
    }
    return map;
  }, [visibleLectures, slotWindows]);

  const facultyWorkload = useMemo(() => {
    const map = new Map<string, number>();
    for (const lec of mergedLectures) {
      const start = new Date(lec.startsAt).getTime();
      const end = new Date(lec.endsAt).getTime();
      const hours = Math.max(0, (end - start) / (1000 * 60 * 60));
      map.set(lec.facultyId, (map.get(lec.facultyId) ?? 0) + hours);
    }
    return map;
  }, [mergedLectures]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (departmentId) params.set("departmentId", departmentId);
      if (filterFrom) params.set("from", new Date(filterFrom).toISOString());
      if (filterTo) params.set("to", new Date(filterTo).toISOString());
      const response = await apiFetch<ScheduleResponse>(`/api/hod/schedule${params.toString() ? `?${params.toString()}` : ""}`);
      setData(response);

      if (!departmentId) setDepartmentId(response.departments[0]?.id ?? "");
      if (!facultyId) setFacultyId(response.faculties[0]?.id ?? "");
      if (!roomId) setRoomId(response.rooms[0]?.id ?? "");
      if (!moveRoomId) setMoveRoomId(response.rooms[0]?.id ?? "");
      if (!subjectId) setSubjectId(response.subjects[0]?.id ?? "");
      if (!filterFrom && response.window.from) setFilterFrom(response.window.from.slice(0, 16));
      if (!filterTo && response.window.to) setFilterTo(response.window.to.slice(0, 16));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load schedule");
    } finally {
      setLoading(false);
    }
  }, [departmentId, facultyId, filterFrom, filterTo, moveRoomId, roomId, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createLecture = useCallback(async (payload: {
    departmentId: string;
    facultyId: string;
    roomId: string;
    subjectId?: string;
    substituteFacultyId?: string;
    startsAt: string;
    endsAt: string;
  }) => {
    setError(null);
    try {
      await apiFetch<{ lectureId: string }>("/api/hod/schedule", {
        method: "POST",
        body: JSON.stringify({
          departmentId: payload.departmentId,
          facultyId: payload.facultyId,
          roomId: payload.roomId,
          subjectId: payload.subjectId || null,
          substituteFacultyId: payload.substituteFacultyId || undefined,
          startsAt: new Date(payload.startsAt).toISOString(),
          endsAt: new Date(payload.endsAt).toISOString(),
        }),
      });
      setConflictNote(null);
      setSuggestedRooms([]);
      setSuggestedSlots([]);
      await load();
      return true;
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to create lecture";
      setError(message);
      setConflictNote(message);
      if (hasWindow) {
        const altRooms = availableRooms.map((r) => r.name).slice(0, 5);
        setSuggestedRooms(altRooms);
        const nextSlots = slotWindows.slice(1, 4).map((slot) => {
          const datePart = toLocalDatePart(weekStart);
          const start = `${datePart}T${slot.start}`;
          const end = `${datePart}T${slot.end}`;
          return { label: slot.label, startsAt: start, endsAt: end };
        });
        setSuggestedSlots(nextSlots);
      }
      return false;
    }
  }, [availableRooms, hasWindow, load, slotWindows, weekStart]);

  const handleAddSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!departmentId || !facultyId || !roomId || !startsAt || !endsAt) return;

    const created = await createLecture({
      departmentId,
      facultyId,
      roomId,
      subjectId,
      substituteFacultyId,
      startsAt,
      endsAt,
    });

    if (created) {
      setStartsAt("");
      setEndsAt("");
      setSubstituteFacultyId("");
    }
  };

  const handleRoomChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedLectureId || !moveRoomId) return;

    setError(null);
    try {
      await apiFetch("/api/hod/schedule", {
        method: "PATCH",
        body: JSON.stringify({ lectureId: selectedLectureId, roomId: moveRoomId }),
      });
      setSelectedLectureId("");
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to move lecture room");
    }
  };

  const handleAssignSubstitute = async (lectureId: string) => {
    const substituteId = substituteByLecture[lectureId];
    if (!substituteId) return;
    setSubmittingSubstitute(lectureId);
    setError(null);
    try {
      await apiFetch("/api/hod/schedule", {
        method: "PATCH",
        body: JSON.stringify({ lectureId, substituteFacultyId: substituteId, isSubstitute: true }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to assign substitute");
    } finally {
      setSubmittingSubstitute(null);
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, card: DragCard) => {
    event.dataTransfer.setData("application/json", JSON.stringify(card));
  };

  const getAvailableRoomsForWindow = useCallback((slotStart: string, slotEnd: string, slotDepartmentId?: string) => {
    if (!data) return [] as Array<{ id: string; name: string }>;
    const startMs = new Date(slotStart).getTime();
    const endMs = new Date(slotEnd).getTime();
    const scopedRooms = data.rooms.filter((room) => !slotDepartmentId || !room.department_id || room.department_id === slotDepartmentId);
    const freeRooms = scopedRooms.filter((room) => {
      return !mergedLectures.some((lecture) => {
        if (lecture.roomId !== room.id) return false;
        const lectureStart = new Date(lecture.startsAt).getTime();
        const lectureEnd = new Date(lecture.endsAt).getTime();
        return lectureStart < endMs && lectureEnd > startMs;
      });
    });

    return freeRooms.map((room) => ({ id: room.id, name: room.name }));
  }, [data, mergedLectures]);

  const getRoomNameById = useCallback((candidateRoomId: string) => {
    if (!data) return candidateRoomId;
    return data.rooms.find((room) => room.id === candidateRoomId)?.name ?? candidateRoomId;
  }, [data]);

  const isRoomFreeInWindow = useCallback((candidateRoomId: string, slotStart: string, slotEnd: string) => {
    const startMs = new Date(slotStart).getTime();
    const endMs = new Date(slotEnd).getTime();
    return !mergedLectures.some((lecture) => {
      if (lecture.roomId !== candidateRoomId) return false;
      const lectureStart = new Date(lecture.startsAt).getTime();
      const lectureEnd = new Date(lecture.endsAt).getTime();
      return lectureStart < endMs && lectureEnd > startMs;
    });
  }, [mergedLectures]);

  const getAvailableRoomIdForWindow = useCallback((slotStart: string, slotEnd: string, slotDepartmentId?: string) => {
    return getAvailableRoomsForWindow(slotStart, slotEnd, slotDepartmentId)[0]?.id ?? "";
  }, [getAvailableRoomsForWindow]);

  const handleDropOnSlot = async (event: DragEvent<HTMLDivElement>, day: Date, slot: { start: string; end: string }) => {
    event.preventDefault();
    const text = event.dataTransfer.getData("application/json");
    if (!text) return;

    const card = JSON.parse(text) as DragCard;
    const datePart = toLocalDatePart(day);
    const startIso = `${datePart}T${slot.start}`;
    const endIso = `${datePart}T${slot.end}`;

    if (new Date(endIso).getTime() <= Date.now()) {
      toast.error("Past slot cannot be scheduled");
      return;
    }

    const availableRoomsForSlot = getAvailableRoomsForWindow(startIso, endIso, card.departmentId);
    if (availableRoomsForSlot.length === 0) {
      toast.error("No free room available for this slot");
      return;
    }

    let targetRoomId = "";
    if (plannerRoomMode === "manual") {
      if (!roomId) {
        toast.error("Select a room in planner settings first");
        return;
      }
      if (!isRoomFreeInWindow(roomId, startIso, endIso)) {
        const options = availableRoomsForSlot.map((room) => room.name).join(", ");
        toast.error(`Selected room is busy. Free rooms: ${options}`);
        return;
      }
      targetRoomId = roomId;
    } else {
      targetRoomId = getAvailableRoomIdForWindow(startIso, endIso, card.departmentId);
    }

    if (!targetRoomId) {
      toast.error("Unable to resolve room for selected slot");
      return;
    }

    const created = await createLecture({
      departmentId: card.departmentId || departmentId || data?.departments[0]?.id || "",
      facultyId: card.facultyId,
      roomId: targetRoomId,
      subjectId: card.subjectId ?? undefined,
      startsAt: startIso,
      endsAt: endIso,
    });

    if (created) {
      toast.success(`Lecture created in room ${getRoomNameById(targetRoomId)}`);
    }
  };

  const allowDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleExport = () => {
    const params = new URLSearchParams();
    if (departmentId) params.set("departmentId", departmentId);
    if (filterFrom) params.set("from", new Date(filterFrom).toISOString());
    if (filterTo) params.set("to", new Date(filterTo).toISOString());
    params.set("format", "csv");
    window.open(`/api/hod/schedule?${params.toString()}`, "_blank");
  };

  if (loading && !data && !error) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <SectionCard
        title="Schedule Lectures"
        description="Assign faculty, room, time, subject, and substitutes with conflict checks"
        actionSlot={
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded-full bg-slate-100 px-2 py-1">Live occupied: {occupiedCount}</span>
            <button onClick={handleExport} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold text-slate-700">
              Export CSV
            </button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-4">
          <label className="text-xs font-semibold text-slate-600">Department
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
              {data?.departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">From
            <input type="datetime-local" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-600">To
            <input type="datetime-local" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="flex items-end justify-end gap-2">
            <button onClick={load} className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:w-auto" disabled={loading}>
              Refresh
            </button>
          </div>
        </div>

        {conflictNote ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <p className="font-semibold">Conflict detected: {conflictNote}</p>
            {suggestedRooms.length ? <p className="mt-1">Try rooms: {suggestedRooms.join(", ")}</p> : null}
            {suggestedSlots.length ? (
              <div className="mt-1 space-y-1">
                {suggestedSlots.map((slot) => (
                  <p key={slot.label}>Alt slot {slot.label}: {slot.startsAt.replace("T", " ")} → {slot.endsAt.replace("T", " ")}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Smart builder</span>
            <button
              type="button"
              onClick={() => {
                setFacultyId(smartSuggest.facultyId || facultyId);
                setRoomId(smartSuggest.roomId || roomId);
                setStartsAt(smartSuggest.start);
                setEndsAt(smartSuggest.end);
              }}
              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
            >
              Apply suggested window
            </button>
            <input
              type="number"
              min={30}
              max={180}
              value={smartDurationMinutes}
              onChange={(e) => setSmartDurationMinutes(Number(e.target.value))}
              className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs"
            />
            <span className="text-xs text-slate-600">minutes</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700">
            <span className="rounded-full bg-white px-3 py-1 shadow">Next free faculty: {smartSuggest.facultyId ? data?.faculties.find((f) => f.id === smartSuggest.facultyId)?.name ?? "" : "—"}</span>
            <span className="rounded-full bg-white px-3 py-1 shadow">Next free room: {smartSuggest.roomId ? data?.rooms.find((r) => r.id === smartSuggest.roomId)?.name ?? "" : "—"}</span>
            <span className="rounded-full bg-white px-3 py-1 shadow">Window: {smartSuggest.start.replace("T", " ")} → {smartSuggest.end.replace("T", " ")}</span>
          </div>
        </div>

        <form onSubmit={handleAddSchedule} className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <select value={facultyId} onChange={(e) => { setFacultyId(e.target.value); setSubstituteFacultyId(""); }} className="rounded-xl border border-slate-300 px-3 py-2" required>
            <option value="">Select faculty</option>
            {(hasWindow ? availableFaculties : data?.faculties ?? []).map((faculty) => (
              <option key={faculty.id} value={faculty.id}>{faculty.name}</option>
            ))}
          </select>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2">
            <option value="">Subject (optional)</option>
            {filteredSubjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </select>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" required>
            <option value="">Select room</option>
            {(hasWindow ? availableRooms : data?.rooms ?? []).map((room) => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
          <select value={substituteFacultyId} onChange={(e) => setSubstituteFacultyId(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2">
            <option value="">Substitute (optional)</option>
            {substituteCandidates.map((faculty) => (
              <option key={faculty.id} value={faculty.id}>{faculty.name}</option>
            ))}
          </select>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" required />
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2" required />
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button type="submit" className="w-full rounded-xl bg-teal-700 px-4 py-2 font-semibold text-white sm:w-auto" disabled={loading}>
              Add Lecture
            </button>
            <button type="button" onClick={() => { setStartsAt(""); setEndsAt(""); setSubstituteFacultyId(""); }} className="w-full rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700 sm:w-auto">
              Clear
            </button>
          </div>
          <p className="text-xs text-slate-500 md:col-span-2">
            Subject auto-fills from faculty mapping. Substitute can be selected only from currently available faculty.
          </p>
        </form>

        {hasWindow ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 text-xs text-slate-700">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="mb-2 font-semibold text-slate-800">Available faculty (window)</p>
              {availableFaculties.length ? (
                <div className="flex flex-wrap gap-2">
                  {availableFaculties.map((f) => (
                    <span key={f.id} className="rounded-full bg-white px-3 py-1 shadow">{f.name}</span>
                  ))}
                </div>
              ) : (
                <p>No free faculty in this window.</p>
              )}
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="mb-2 font-semibold text-slate-800">Available rooms (window)</p>
              {availableRooms.length ? (
                <div className="flex flex-wrap gap-2">
                  {availableRooms.map((r) => (
                    <span key={r.id} className="rounded-full bg-white px-3 py-1 shadow">{r.name}</span>
                  ))}
                </div>
              ) : (
                <p>No free rooms in this window.</p>
              )}
            </div>
          </div>
        ) : null}

        <form onSubmit={handleRoomChange} className="mt-5 space-y-3 border-t border-slate-200 pt-4 text-sm">
          <p className="font-semibold text-slate-700">Quick Move / Swap</p>
          <select value={selectedLectureId} onChange={(e) => setSelectedLectureId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
            <option value="">Select lecture</option>
            {visibleLectures.map((item) => (
              <option key={item.id} value={item.id}>
                {new Date(item.startsAt).toLocaleString()} · {item.subjectName || "Lecture"} · {item.facultyName}
              </option>
            ))}
          </select>
          <select value={moveRoomId} onChange={(e) => setMoveRoomId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2">
            {data?.rooms.map((room) => (
              <option key={room.id} value={room.id}>{room.name}</option>
            ))}
          </select>
          <button type="submit" className="w-full rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white sm:w-auto" disabled={loading}>
            Move Room
          </button>
        </form>
      </SectionCard>

      <SectionCard
        title="Lecture Planner"
        description="Filtered by department and date window"
        actionSlot={
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={showPastLectures}
              onChange={(e) => setShowPastLectures(e.target.checked)}
            />
            Show past lectures
          </label>
        }
      >
        <div className="space-y-3 text-sm">
          {visibleLectures.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.departmentName}</p>
                  <p className="text-base font-semibold text-slate-900">{item.subjectName || "Lecture"}</p>
                  <p className="text-slate-700">{item.facultyName}{item.substituteFacultyName ? ` (sub: ${item.substituteFacultyName})` : ""}</p>
                  <p className="text-slate-600">Room {item.roomName || "TBD"}</p>
                </div>
                <div className="flex flex-row flex-wrap items-center gap-1 text-xs font-semibold sm:flex-col sm:items-end">
                  <span className={`rounded-full px-3 py-1 ${item.liveStatus === "occupied" ? "bg-teal-100 text-teal-800" : "bg-slate-200 text-slate-700"}`}>
                    {item.liveStatus}
                  </span>
                  {item.alerts > 0 ? <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Alerts {item.alerts}</span> : null}
                  {item.attendanceLocked ? <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-700">Locked</span> : null}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <span className="rounded-lg bg-white px-2 py-1 shadow">{new Date(item.startsAt).toLocaleString()} - {new Date(item.endsAt).toLocaleTimeString()}</span>
                <span className="rounded-lg bg-white px-2 py-1 shadow">Attendance: {item.attendancePercent ?? "—"}% ({item.presentCount}/{item.totalMarked})</span>
                {item.isStartingSoon ? <span className="rounded-lg bg-amber-100 px-2 py-1 text-amber-800">Starting soon</span> : null}
                {item.isOverdue ? <span className="rounded-lg bg-rose-100 px-2 py-1 text-rose-700">Overdue</span> : null}
                {item.conflicts.length > 0 ? (
                  <span className="rounded-lg bg-rose-100 px-2 py-1 text-rose-700">Conflicts: {item.conflicts.length}</span>
                ) : null}
              </div>
              {item.conflicts.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-rose-700">
                  {item.conflicts.map((conflict) => (
                    <li key={conflict}>{conflict}</li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={substituteByLecture[item.id] ?? ""}
                  onChange={(e) => setSubstituteByLecture((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">Assign substitute</option>
                  {data?.faculties
                    .filter((f) => f.department_id === item.departmentId && f.id !== item.facultyId)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleAssignSubstitute(item.id)}
                  disabled={!substituteByLecture[item.id] || submittingSubstitute === item.id}
                  className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-60"
                >
                  {submittingSubstitute === item.id ? "Assigning..." : "Set substitute"}
                </button>
              </div>
            </div>
          ))}
          {visibleLectures.length === 0 && !loading ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-slate-600">No lectures in this window.</p>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Visual timetable builder" description="Drag faculty+subject onto a weekly grid (conflicts checked on drop)">
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Faculty + subject cards</p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Room strategy</p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-700">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name="planner-room-mode"
                    checked={plannerRoomMode === "auto"}
                    onChange={() => setPlannerRoomMode("auto")}
                  />
                  Auto (first free room)
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name="planner-room-mode"
                    checked={plannerRoomMode === "manual"}
                    onChange={() => setPlannerRoomMode("manual")}
                  />
                  Manual room
                </label>
              </div>
              {plannerRoomMode === "manual" ? (
                <select
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="">Select room for timetable drops</option>
                  {plannerRoomChoices.map((room) => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              ) : null}
              <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Slot duration
                <select
                  value={plannerSlotMinutes}
                  onChange={(e) => setPlannerSlotMinutes(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700"
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes (default)</option>
                  <option value={90}>90 minutes</option>
                  <option value={120}>120 minutes</option>
                </select>
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-1">
              {dragCards.map((card) => (
                <div
                  key={`${card.facultyId}-${card.subjectId ?? "any"}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, card)}
                  className="cursor-grab rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm"
                >
                  <p className="font-semibold text-slate-900">{card.facultyName}</p>
                  <p className="text-xs text-slate-600">{card.subjectName}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Drop on a slot to create. In manual mode, selected room must be free in that slot.
            </p>
          </div>

          <div className="overflow-auto lg:col-span-3">
            <table className="min-w-full text-xs text-slate-800">
              <thead>
                <tr>
                  <th className="p-2 text-left">Time</th>
                  {weekDays.map((day) => (
                    <th key={day.toDateString()} className="p-2 text-left">{day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slotWindows.map((slot) => (
                  <tr key={slot.label} className="align-top">
                    <td className="p-2 font-semibold text-slate-700">{slot.label}</td>
                    {weekDays.map((day) => {
                      const key = `${day.toDateString()}-${slot.label}`;
                      const list = lecturesByCell.get(key) ?? [];
                      const datePart = toLocalDatePart(day);
                      const slotEnd = new Date(`${datePart}T${slot.end}`);
                      const isPastSlot = slotEnd.getTime() <= Date.now();
                      return (
                        <td
                          key={key}
                          className="min-w-[180px] p-2"
                          onDragOver={isPastSlot ? undefined : allowDrop}
                          onDrop={isPastSlot ? undefined : (e) => void handleDropOnSlot(e, day, slot)}
                        >
                          <div className={`min-h-[90px] rounded-xl border border-dashed p-2 ${isPastSlot ? "border-slate-200 bg-slate-100" : "border-slate-200 bg-slate-50"}`}>
                            {list.length === 0 ? (
                              <p className="text-[11px] text-slate-500">{isPastSlot ? "Past slot" : "Drop to schedule"}</p>
                            ) : null}
                            {list.map((lec) => (
                              <div key={lec.id} className="mb-2 rounded-lg border border-slate-200 bg-white px-2 py-1 shadow-sm">
                                <p className="text-xs font-semibold text-slate-900">{lec.subjectName || "Lecture"}</p>
                                <p className="text-[11px] text-slate-600">{lec.facultyName}</p>
                                <p className="text-[11px] text-slate-500">Room {lec.roomName}</p>
                                {lec.conflicts.length > 0 ? <p className="text-[11px] text-rose-700">Conflicts: {lec.conflicts.length}</p> : null}
                              </div>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
            <button onClick={() => toast("Template save pending backend storage")} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold">Save as template</button>
            <button onClick={() => toast("Template clone pending backend storage")} className="rounded-lg border border-slate-300 px-3 py-1 font-semibold">Clone template</button>
        </div>
      </SectionCard>

      <SectionCard title="Faculty workload" description="Hours per week with max limit alert">
        <div className="grid gap-3 md:grid-cols-3 text-sm">
          {data?.faculties.map((f) => {
            const hours = facultyWorkload.get(f.id) ?? 0;
            const overLimit = hours > 18;
            return (
              <div key={f.id} className={`rounded-xl border ${overLimit ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white"} p-3 shadow-sm`}>
                <p className="font-semibold text-slate-900">{f.name}</p>
                <p className="text-slate-700">{hours.toFixed(1)} hrs / week</p>
                {overLimit ? <p className="text-xs font-semibold text-rose-700">Above 18 hr limit</p> : null}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
