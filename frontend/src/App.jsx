import { useEffect, useState } from "react";
import { api, clearAccessKey, hasAccessKey, saveAccessKey } from "./api.js";
import {
  MATERIAL_LABEL,
  TONE_LABEL,
  assignmentIdFromUrl,
  courseHash,
  deadlineTone,
  parseHash,
  resourceHref,
} from "./format.js";

function go(hash) {
  window.location.hash = hash;
}

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const [tick, setTick] = useState(0);
  const [access, setAccess] = useState("checking");
  const [invalidKey, setInvalidKey] = useState(false);
  const [courses, setCourses] = useState({ status: "loading", data: [], error: "" });
  const [deadlines, setDeadlines] = useState({ status: "loading", data: [], error: "" });
  const route = parseHash(hash);

  useEffect(() => {
    let cancel = false;
    fetch("/api/health")
      .then((response) => response.json())
      .then((data) => {
        if (cancel) return;
        if (data.access === "required" && !hasAccessKey()) setAccess("locked");
        else setAccess("ready");
      })
      .catch(() => {
        if (!cancel) setAccess("ready");
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (access !== "ready") return undefined;
    let cancel = false;
    setCourses((current) => ({ ...current, status: "loading", error: "" }));
    setDeadlines((current) => ({ ...current, status: "loading", error: "" }));

    const fail = (error) => {
      if (cancel) return;
      if (error.code === "access") {
        clearAccessKey();
        setInvalidKey(true);
        setAccess("locked");
      }
    };

    api("/api/courses")
      .then((data) => {
        if (!cancel) setCourses({ status: "ready", data, error: "" });
      })
      .catch((error) => {
        fail(error);
        if (!cancel) setCourses({ status: "error", data: [], error: error.message });
      });

    api("/api/deadlines")
      .then((data) => {
        if (!cancel) setDeadlines({ status: "ready", data, error: "" });
      })
      .catch((error) => {
        fail(error);
        if (!cancel) setDeadlines({ status: "error", data: [], error: error.message });
      });

    return () => {
      cancel = true;
    };
  }, [tick, access]);

  if (access === "checking") {
    return (
      <main className="gate">
        <p>Memeriksa sesi…</p>
      </main>
    );
  }

  if (access === "locked") {
    return (
      <Gate
        invalid={invalidKey}
        onSuccess={() => {
          setInvalidKey(false);
          setAccess("ready");
        }}
      />
    );
  }

  const courseNav = route.page === "courses" || route.page === "course";

  return (
    <div className="app">
      <aside>
        <a className="brand" href="#/">
          <span className="mark" aria-hidden="true">
            P
          </span>
          <span>
            <strong>LMS Polinema</strong>
            <small>Semester berjalan</small>
          </span>
        </a>
        <nav>
          <a className={route.page === "home" ? "active" : ""} href="#/">
            Ikhtisar
          </a>
          <a className={courseNav ? "active" : ""} href="#/courses">
            Mata kuliah
          </a>
        </nav>
        <p className="aside-note">Bukan situs resmi Polinema. Data dibaca dari sesi di komputer ini.</p>
      </aside>
      <main>
        {courses.status === "error" ? <ErrorBanner message={courses.error} onRetry={() => setTick((n) => n + 1)} /> : null}
        {route.page === "home" ? (
          <Home
            courses={courses}
            deadlines={deadlines}
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : null}
        {route.page === "courses" ? <CourseIndex courses={courses} /> : null}
        {route.page === "course" ? <CoursePage route={route} courses={courses} /> : null}
        {route.page === "assignment" ? <AssignmentPage assignmentId={route.assignmentId} /> : null}
      </main>
    </div>
  );
}

function Home({ courses, deadlines, onRetry }) {
  const linked = courses.data.filter((course) => course.moodle_id != null).length;
  const openCount = deadlines.data.filter((item) => deadlineTone(item) !== "done").length;
  const sorted = [...deadlines.data].sort(
    (a, b) => toneRank(deadlineTone(a)) - toneRank(deadlineTone(b)),
  );

  return (
    <>
      <header className="page-head">
        <p className="kicker">Ikhtisar</p>
        <div className="head-row">
          <h1>Yang perlu dikerjakan</h1>
          <button type="button" className="ghost" onClick={onRetry}>
            Muat ulang
          </button>
        </div>
      </header>
      <section className="stats" aria-label="Ringkasan">
        <Stat value={courses.status === "ready" ? courses.data.length : "…"} label="Mata kuliah" />
        <Stat value={courses.status === "ready" ? linked : "…"} label="Terhubung ke Moodle" />
        <Stat value={deadlines.status === "ready" ? openCount : "…"} label="Tugas belum selesai" />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Tenggat</h2>
          {deadlines.status === "loading" ? <span className="hint">Membaca halaman tugas di Moodle…</span> : null}
        </div>
        {deadlines.status === "error" ? <p className="inline-error">{deadlines.error}</p> : null}
        {deadlines.status === "loading" && deadlines.data.length === 0 ? <SkeletonRows /> : null}
        {deadlines.status === "ready" && sorted.length === 0 ? (
          <p className="empty">Belum ada tugas yang terbaca dari mata kuliah yang terhubung.</p>
        ) : null}
        <ul className="deadline-list">
          {sorted.map((item) => {
            const tone = deadlineTone(item);
            const id = assignmentIdFromUrl(item.url);
            return (
              <li key={`${item.course}-${item.title}-${item.url}`}>
                <button
                  type="button"
                  className="deadline"
                  disabled={id == null}
                  onClick={() => id != null && go(`#/assignment/${id}`)}
                >
                  <span className={`dot tone-${tone}`} aria-hidden="true" />
                  <span className="deadline-copy">
                    <strong>{item.title}</strong>
                    <span>
                      {item.course}
                      {item.due_date ? ` · ${item.due_date}` : ""}
                    </span>
                  </span>
                  <span className={`pill tone-${tone}`}>{item.time_remaining || TONE_LABEL[tone]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Mata kuliah</h2>
        </div>
        <CourseGrid courses={courses} />
      </section>
    </>
  );
}

function CourseIndex({ courses }) {
  return (
    <>
      <header className="page-head">
        <p className="kicker">Mata kuliah</p>
        <h1>Semester ini</h1>
      </header>
      <CourseGrid courses={courses} />
    </>
  );
}

function CourseGrid({ courses }) {
  if (courses.status === "loading" && courses.data.length === 0) {
    return (
      <div className="course-grid">
        <div className="skeleton card-skel" />
        <div className="skeleton card-skel" />
        <div className="skeleton card-skel" />
      </div>
    );
  }
  if (courses.status === "error") return null;
  return (
    <div className="course-grid">
      {courses.data.map((course) => (
        <button key={course.moodle_id ?? course.title} type="button" className="course" onClick={() => go(courseHash(course))}>
          <span className={course.moodle_id != null ? "course-flag linked" : "course-flag"}>
            {course.moodle_id != null ? "Moodle" : "Tanpa tautan"}
          </span>
          <strong>{course.title}</strong>
        </button>
      ))}
    </div>
  );
}

function CoursePage({ route, courses }) {
  const course = findCourse(courses.data, route);
  const [detail, setDetail] = useState({ status: "idle", assignments: [], materials: [], error: "" });

  useEffect(() => {
    if (!course?.moodle_id) return undefined;
    let cancel = false;
    setDetail({ status: "loading", assignments: [], materials: [], error: "" });
    Promise.all([api(`/api/assignments?course_id=${course.moodle_id}`), api(`/api/materials/${course.moodle_id}`)])
      .then(([assignments, materials]) => {
        if (!cancel) setDetail({ status: "ready", assignments, materials, error: "" });
      })
      .catch((error) => {
        if (!cancel) setDetail({ status: "error", assignments: [], materials: [], error: error.message });
      });
    return () => {
      cancel = true;
    };
  }, [course?.moodle_id]);

  if (courses.status === "loading" && !course) {
    return <p className="hint page-pad">Memuat mata kuliah…</p>;
  }
  if (!course) {
    return (
      <div className="page-pad">
        <p className="empty">Mata kuliah tidak ditemukan.</p>
        <a href="#/courses">Kembali ke daftar</a>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <p className="kicker">
          <a href="#/courses">Mata kuliah</a>
        </p>
        <h1>{course.title}</h1>
        {course.moodle_url ? (
          <p className="hint">Lampiran dibuka lewat sesi aplikasi ini. Halaman Moodle penuh tetap butuh login di browser.</p>
        ) : (
          <p className="hint">Dosen belum menautkan kelas ini ke Moodle, jadi tugas dan materi tidak tersedia.</p>
        )}
      </header>
      {course.moodle_id == null ? null : (
        <div className="split">
          <section className="panel">
            <div className="panel-head">
              <h2>Tugas</h2>
            </div>
            {detail.status === "loading" ? <SkeletonRows /> : null}
            {detail.status === "error" ? <p className="inline-error">{detail.error}</p> : null}
            {detail.status === "ready" && detail.assignments.length === 0 ? <p className="empty">Tidak ada tugas.</p> : null}
            <ul className="plain-list">
              {detail.assignments.map((item) => (
                <li key={item.assignment_id}>
                  <button type="button" onClick={() => go(`#/assignment/${item.assignment_id}`)}>
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Materi</h2>
            </div>
            {detail.status === "loading" ? <SkeletonRows /> : null}
            {detail.status === "ready" && detail.materials.length === 0 ? <p className="empty">Tidak ada materi.</p> : null}
            <ul className="plain-list">
              {detail.materials.map((item) => {
                const href = resourceHref(item.url);
                return (
                  <li key={`${item.type}-${item.id}-${item.url}`}>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer">
                        <em>{MATERIAL_LABEL[item.type] || item.type}</em>
                        {item.name}
                      </a>
                    ) : (
                      <span>{item.name}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

function AssignmentPage({ assignmentId }) {
  const [state, setState] = useState({ status: "loading", data: null, error: "" });

  useEffect(() => {
    let cancel = false;
    setState({ status: "loading", data: null, error: "" });
    api(`/api/assignments/${assignmentId}`)
      .then((data) => {
        if (!cancel) setState({ status: "ready", data, error: "" });
      })
      .catch((error) => {
        if (!cancel) setState({ status: "error", data: null, error: error.message });
      });
    return () => {
      cancel = true;
    };
  }, [assignmentId]);

  return (
    <>
      <header className="page-head">
        <p className="kicker">
          <a href="#/">Ikhtisar</a>
        </p>
        <h1>{state.data?.title || (state.status === "loading" ? "Memuat tugas…" : "Tugas")}</h1>
      </header>
      {state.status === "error" ? <p className="inline-error">{state.error}</p> : null}
      {state.status === "loading" ? <SkeletonRows /> : null}
      {state.data ? <AssignmentBody detail={state.data} /> : null}
    </>
  );
}

function AssignmentBody({ detail }) {
  const fields = [
    ["Status pengumpulan", detail.submission_status],
    ["Status penilaian", detail.grading_status],
    ["Tenggat", detail.due_date],
    ["Sisa waktu", detail.time_remaining],
    ["Terakhir diubah", detail.last_modified],
  ].filter(([, value]) => value);

  return (
    <div className="assignment">
      <dl className="meta">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <section className="panel">
        <h2>Instruksi</h2>
        <p className="prose">{detail.description || "Tidak ada instruksi teks."}</p>
      </section>
      <section className="panel">
        <h2>Lampiran</h2>
        {detail.attachments.length === 0 ? <p className="empty">Tidak ada lampiran.</p> : null}
        <ul className="plain-list">
          {detail.attachments.map((file) => {
            const href = resourceHref(file.url);
            return (
              <li key={file.url}>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer">
                    {file.filename}
                  </a>
                ) : (
                  <span>{file.filename}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function findCourse(courses, route) {
  if (route.moodleId != null) return courses.find((course) => course.moodle_id === route.moodleId) || null;
  if (route.title) {
    return (
      courses.find((course) => course.title === route.title) || {
        title: route.title,
        moodle_id: null,
        moodle_url: null,
      }
    );
  }
  return null;
}

function toneRank(tone) {
  if (tone === "late") return 0;
  if (tone === "open") return 1;
  return 2;
}

function Stat({ value, label }) {
  return (
    <article className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function Gate({ invalid, onSuccess }) {
  const [value, setValue] = useState("");

  return (
    <main className="gate">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const key = value.trim();
          if (!key) return;
          saveAccessKey(key);
          onSuccess();
        }}
      >
        <p className="kicker">LMS Polinema</p>
        <h1>Masuk</h1>
        <p className="hint">Halaman ini tidak terbuka untuk umum. Masukkan kunci akses yang kamu simpan saat deploy.</p>
        {invalid ? <p className="inline-error">Kunci akses salah.</p> : null}
        <label>
          Kunci akses
          <input
            type="password"
            autoComplete="current-password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <button type="submit">Buka</button>
      </form>
    </main>
  );
}

function ErrorBanner({ message, onRetry }) {
  const needsLogin = /auth\.py|credentials|session/i.test(message);
  return (
    <div className="banner" role="alert">
      <p>{needsLogin ? "Sesi LMS belum masuk atau sudah habis. Jalankan uv run auth.py di folder proyek, lalu muat ulang." : message}</p>
      <button type="button" onClick={onRetry}>
        Coba lagi
      </button>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="skeletons" aria-hidden="true">
      <div className="skeleton" />
      <div className="skeleton short" />
      <div className="skeleton" />
    </div>
  );
}
