const MOODLE_HOST = "lmsslc.polinema.ac.id";

export function parseHash(hash) {
  const path = (hash || "").replace(/^#/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "courses") return { page: "courses" };
  if (parts[0] === "course" && parts[1] === "unlinked" && parts[2]) {
    return { page: "course", title: decodeURIComponent(parts[2]) };
  }
  if (parts[0] === "course" && /^\d+$/.test(parts[1] || "")) {
    return { page: "course", moodleId: Number(parts[1]) };
  }
  if (parts[0] === "assignment" && /^\d+$/.test(parts[1] || "")) {
    return { page: "assignment", assignmentId: Number(parts[1]) };
  }
  return { page: "home" };
}

export function courseHash(course) {
  if (course.moodle_id != null) return `#/course/${course.moodle_id}`;
  return `#/course/unlinked/${encodeURIComponent(course.title)}`;
}

export function assignmentIdFromUrl(url) {
  try {
    const id = new URL(url).searchParams.get("id");
    return id && /^\d+$/.test(id) ? Number(id) : null;
  } catch {
    return null;
  }
}

export function isSubmitted(status) {
  const value = (status || "").toLowerCase();
  if (/no submission|not submitted|belum|nothing has been submitted/.test(value)) return false;
  return /submitted|dikumpul|graded|dinilai/.test(value);
}

export function deadlineTone(item) {
  if (isSubmitted(item.submission_status)) return "done";
  const time = `${item.time_remaining || ""} ${item.due_date || ""}`.toLowerCase();
  if (/(overdue|terlambat)/.test(time)) return "late";
  return "open";
}

export const TONE_LABEL = {
  late: "Terlambat",
  open: "Belum dikumpulkan",
  done: "Sudah dikumpulkan",
};

export function resourceHref(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.hostname === MOODLE_HOST) {
      return `/api/resource?url=${encodeURIComponent(parsed.toString())}`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export const MATERIAL_LABEL = {
  resource: "Berkas",
  folder: "Folder",
  url: "Tautan",
  page: "Halaman",
  forum: "Forum",
  quiz: "Kuis",
  assign: "Tugas",
};
