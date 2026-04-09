import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router";
import { API_BASE } from "../helpers/constants";
import "./InteractiveReportPage.css";

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface MedicalTerm {
  term: string;
  definition: string;
  example_note: string;
}

interface Finding {
  id: string;
  sentence: string;
  organ: string | null;
  finding_type: "lesion" | "measurement" | "observation";
  linked_image_ids: string[];
  medical_terms: MedicalTerm[];
}

interface KeyImage {
  id: string;
  organ: string;
  view_type: "overlay" | "zoomed";
  slice_index: number;
  image_data_base64: string | null;
  linked_finding_ids: string[];
}

interface Measurement {
  organ: string;
  volume_cc: number | null;
  lesion_count: number;
  lesion_volume_cc: number | null;
}

interface ReportData {
  case_id: string;
  patient: { bdmap_id: string; age: number | null; sex: string | null };
  imaging: Record<string, string | null>;
  measurements: Measurement[];
  narrative_report: string;
  structured_report: string;
  findings: Finding[];
  key_images: KeyImage[];
}

/* ─── Organ color mapping ─────────────────────────────────────────────────── */
const ORGAN_COLORS: Record<string, string> = {
  pancreas: "#e85d75",
  liver: "#c06040",
  kidney: "#4a8fe7",
};

const ORGAN_BG: Record<string, string> = {
  pancreas: "rgba(232,93,117,0.08)",
  liver: "rgba(192,96,64,0.08)",
  kidney: "rgba(74,143,231,0.08)",
};

function organColor(organ: string | null) {
  return organ ? ORGAN_COLORS[organ] ?? "#888" : "#888";
}

/* ─── Term Tooltip Component ──────────────────────────────────────────────── */
function TermTooltip({
  term,
  onClose,
}: {
  term: MedicalTerm;
  onClose: () => void;
}) {
  return (
    <div className="ir-term-tooltip" onClick={(e) => e.stopPropagation()}>
      <div className="ir-term-tooltip__header">
        <span className="ir-term-tooltip__title">{term.term}</span>
        <button className="ir-term-tooltip__close" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="ir-term-tooltip__def">{term.definition}</p>
      {term.example_note && (
        <p className="ir-term-tooltip__example">
          <strong>Clinical note:</strong> {term.example_note}
        </p>
      )}
    </div>
  );
}

/* ─── Finding Sentence with clickable terms ───────────────────────────────── */
function FindingSentence({
  finding,
  isActive,
  onClick,
}: {
  finding: Finding;
  isActive: boolean;
  onClick: () => void;
}) {
  const [activeTerm, setActiveTerm] = useState<MedicalTerm | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isActive]);

  // Build sentence with clickable terms
  const renderSentence = () => {
    let text = finding.sentence;
    if (finding.medical_terms.length === 0) return <span>{text}</span>;

    // Sort terms by length (longest first) to avoid partial matches
    const sorted = [...finding.medical_terms].sort(
      (a, b) => b.term.length - a.term.length
    );

    type Segment = { type: "text" | "term"; content: string; term?: MedicalTerm };
    let segments: Segment[] = [{ type: "text", content: text }];

    for (const t of sorted) {
      const next: Segment[] = [];
      for (const seg of segments) {
        if (seg.type === "term") {
          next.push(seg);
          continue;
        }
        const regex = new RegExp(`(${t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
        const parts = seg.content.split(regex);
        for (const part of parts) {
          if (part.toLowerCase() === t.term.toLowerCase()) {
            next.push({ type: "term", content: part, term: t });
          } else if (part) {
            next.push({ type: "text", content: part });
          }
        }
      }
      segments = next;
    }

    return segments.map((seg, i) =>
      seg.type === "term" ? (
        <span
          key={i}
          className="ir-term-link"
          style={{ color: organColor(finding.organ), borderColor: organColor(finding.organ) }}
          onClick={(e) => {
            e.stopPropagation();
            setActiveTerm(activeTerm?.term === seg.term!.term ? null : seg.term!);
          }}
        >
          {seg.content}
        </span>
      ) : (
        <span key={i}>{seg.content}</span>
      )
    );
  };

  const typeIcon = finding.finding_type === "lesion" ? "◉" : finding.finding_type === "measurement" ? "◫" : "○";

  return (
    <div
      ref={ref}
      className={`ir-finding ${isActive ? "ir-finding--active" : ""} ${
        finding.linked_image_ids.length > 0 ? "ir-finding--linked" : ""
      }`}
      style={{
        borderLeftColor: organColor(finding.organ),
        backgroundColor: isActive ? (ORGAN_BG[finding.organ ?? ""] ?? "rgba(136,136,136,0.08)") : undefined,
      }}
      onClick={onClick}
    >
      <span className="ir-finding__icon" title={finding.finding_type}>
        {typeIcon}
      </span>
      <span className="ir-finding__text">{renderSentence()}</span>
      {finding.linked_image_ids.length > 0 && (
        <span className="ir-finding__img-badge" title="Has linked key images">
          🖼 {finding.linked_image_ids.length}
        </span>
      )}
      {activeTerm && (
        <TermTooltip term={activeTerm} onClose={() => setActiveTerm(null)} />
      )}
    </div>
  );
}

/* ─── Key Image Card ──────────────────────────────────────────────────────── */
function KeyImageCard({
  image,
  isActive,
  onClick,
  placeholderMode,
}: {
  image: KeyImage;
  isActive: boolean;
  onClick: () => void;
  placeholderMode: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isActive]);

  return (
    <div
      ref={ref}
      className={`ir-image-card ${isActive ? "ir-image-card--active" : ""}`}
      style={{ borderColor: isActive ? ORGAN_COLORS[image.organ] ?? "#888" : undefined }}
      onClick={onClick}
    >
      <div className="ir-image-card__viewport">
        {!placeholderMode && image.image_data_base64 ? (
          <img
            src={`data:image/png;base64,${image.image_data_base64}`}
            alt={`${image.organ} ${image.view_type}`}
            className="ir-image-card__img"
          />
        ) : (
          <div className="ir-image-card__placeholder">
            <span className="ir-image-card__placeholder-icon">🔬</span>
            <span>
              {image.organ.toUpperCase()} — {image.view_type}
            </span>
            <span className="ir-image-card__slice">Slice {image.slice_index}</span>
          </div>
        )}
      </div>
      <div className="ir-image-card__meta">
        <span
          className="ir-image-card__organ-tag"
          style={{ background: ORGAN_COLORS[image.organ] ?? "#888" }}
        >
          {image.organ}
        </span>
        <span className="ir-image-card__type">{image.view_type}</span>
        <span className="ir-image-card__linked">
          {image.linked_finding_ids.length} finding{image.linked_finding_ids.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

/* ─── Measurements Table ──────────────────────────────────────────────────── */
function MeasurementsTable({ measurements }: { measurements: Measurement[] }) {
  return (
    <table className="ir-measurements">
      <thead>
        <tr>
          <th>Organ</th>
          <th>Volume (cc)</th>
          <th>Lesions</th>
          <th>Lesion Vol (cc)</th>
        </tr>
      </thead>
      <tbody>
        {measurements.map((m) => (
          <tr key={m.organ}>
            <td>
              <span
                className="ir-measurements__dot"
                style={{ background: ORGAN_COLORS[m.organ] ?? "#888" }}
              />
              {m.organ}
            </td>
            <td>{m.volume_cc != null ? m.volume_cc.toFixed(1) : "N/A"}</td>
            <td className={m.lesion_count > 0 ? "ir-measurements--alert" : ""}>
              {m.lesion_count}
            </td>
            <td>{m.lesion_volume_cc != null ? m.lesion_volume_cc.toFixed(1) : "N/A"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─── View Toggle (2D / 3D placeholder) ───────────────────────────────────── */
function ViewToggle({
  mode,
  onChange,
}: {
  mode: "2d" | "3d";
  onChange: (m: "2d" | "3d") => void;
}) {
  return (
    <div className="ir-view-toggle">
      <button
        className={`ir-view-toggle__btn ${mode === "2d" ? "ir-view-toggle__btn--active" : ""}`}
        onClick={() => onChange("2d")}
      >
        2D Slices
      </button>
      <button
        className={`ir-view-toggle__btn ${mode === "3d" ? "ir-view-toggle__btn--active" : ""}`}
        onClick={() => onChange("3d")}
      >
        3D Volume
      </button>
    </div>
  );
}

/* ─── 3D Placeholder ──────────────────────────────────────────────────────── */
function ThreeDPlaceholder({ caseId }: { caseId: string }) {
  return (
    <div className="ir-3d-placeholder">
      <div className="ir-3d-placeholder__icon">🧊</div>
      <h3>3D Volume Rendering</h3>
      <p>
        Interactive 3D organ and lesion visualization will render here.
        <br />
        This view will use the NiiVue/Three.js pipeline from the existing
        VisualizationPage.
      </p>
      <Link to={`/case/${caseId}`} className="ir-3d-placeholder__link">
        Open full 3D viewer →
      </Link>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ─── Main Page Component ─────────────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function InteractiveReportPage() {
  const { caseId } = useParams();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bidirectional selection state
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [showStructured, setShowStructured] = useState(false);

  // Fetch report
  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    setError(null);

    const loadDemo = () =>
      fetch(`${API_BASE}/api/interactive-report-demo`)
        .then((r) => r.json())
        .then((data) => setReport(data))
        .catch((e) => setError(e.message));

    // Try real endpoint first, fall back to demo if empty or error
    const url = `${API_BASE}/api/interactive-report/${caseId}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.error) throw new Error(data.error);
        // If the real case returned empty data, use demo instead
        const hasContent = data.findings?.length > 0 || data.narrative_report?.trim();
        if (hasContent) {
          setReport(data);
        } else {
          return loadDemo();
        }
      })
      .catch(() => loadDemo())
      .finally(() => setLoading(false));
  }, [caseId]);

  // ── Click handlers with bidirectional linking ──

  const handleFindingClick = useCallback(
    (finding: Finding) => {
      if (activeFindingId === finding.id) {
        setActiveFindingId(null);
        setActiveImageId(null);
        return;
      }
      setActiveFindingId(finding.id);
      // Auto-select the first linked image
      if (finding.linked_image_ids.length > 0) {
        setActiveImageId(finding.linked_image_ids[0]);
      } else {
        setActiveImageId(null);
      }
    },
    [activeFindingId]
  );

  const handleImageClick = useCallback(
    (image: KeyImage) => {
      if (activeImageId === image.id) {
        setActiveImageId(null);
        setActiveFindingId(null);
        return;
      }
      setActiveImageId(image.id);
      // Auto-select the first linked finding
      if (image.linked_finding_ids.length > 0) {
        setActiveFindingId(image.linked_finding_ids[0]);
      } else {
        setActiveFindingId(null);
      }
    },
    [activeImageId]
  );

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="ir-loading">
        <div className="ir-loading__spinner" />
        <p>Loading interactive report…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="ir-error">
        <h2>Could not load report</h2>
        <p>{error ?? "Unknown error"}</p>
        <Link to="/">← Back to cases</Link>
      </div>
    );
  }

  const hasImages = report.key_images.length > 0;

  return (
    <div className="ir-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="ir-header">
        <Link to="/" className="ir-header__back">
          ← Cases
        </Link>
        <div className="ir-header__title-group">
          <h1 className="ir-header__title">Interactive Radiology Report</h1>
          <span className="ir-header__case-id">Case {report.case_id}</span>
        </div>
        <div className="ir-header__patient">
          {report.patient.age && <span>Age {report.patient.age}</span>}
          {report.patient.sex && <span>{report.patient.sex}</span>}
        </div>
      </header>

      {/* ── Body: two-column layout ────────────────────────────────────── */}
      <div className="ir-body">
        {/* LEFT COLUMN: Report Text */}
        <div className="ir-col ir-col--report">
          {/* Measurements */}
          {report.measurements.length > 0 && (
            <section className="ir-section">
              <h2 className="ir-section__title">AI Measurements</h2>
              <MeasurementsTable measurements={report.measurements} />
            </section>
          )}

          {/* Findings (interactive sentences) */}
          <section className="ir-section">
            <h2 className="ir-section__title">
              Findings
              <span className="ir-section__count">{report.findings.length}</span>
            </h2>
            <p className="ir-section__hint">
              Click a finding to highlight its key image. Click{" "}
              <span className="ir-term-link" style={{ color: "#e85d75", borderColor: "#e85d75", cursor: "default" }}>
                underlined terms
              </span>{" "}
              for definitions.
            </p>
            <div className="ir-findings-list">
              {report.findings.map((f) => (
                <FindingSentence
                  key={f.id}
                  finding={f}
                  isActive={activeFindingId === f.id}
                  onClick={() => handleFindingClick(f)}
                />
              ))}
            </div>
          </section>

          {/* Structured / Narrative toggle */}
          <section className="ir-section">
            <div className="ir-report-toggle">
              <button
                className={!showStructured ? "ir-report-toggle__btn--active" : ""}
                onClick={() => setShowStructured(false)}
              >
                Narrative Report
              </button>
              <button
                className={showStructured ? "ir-report-toggle__btn--active" : ""}
                onClick={() => setShowStructured(true)}
              >
                Structured Report
              </button>
            </div>
            <div className="ir-report-text">
              {showStructured ? report.structured_report : report.narrative_report}
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: Images */}
        <div className="ir-col ir-col--images">
          <div className="ir-col__sticky">
            <ViewToggle mode={viewMode} onChange={setViewMode} />

            {viewMode === "2d" ? (
              hasImages ? (
                <div className="ir-images-grid">
                  {report.key_images.map((img) => (
                    <KeyImageCard
                      key={img.id}
                      image={img}
                      isActive={activeImageId === img.id}
                      onClick={() => handleImageClick(img)}
                      placeholderMode={!img.image_data_base64}
                    />
                  ))}
                </div>
              ) : (
                <div className="ir-no-images">
                  <p>No key images available for this case.</p>
                  <p className="ir-no-images__sub">
                    Images are generated when lesion segmentation masks are present.
                  </p>
                </div>
              )
            ) : (
              <ThreeDPlaceholder caseId={report.case_id} />
            )}

            {/* Imaging details */}
            {Object.keys(report.imaging).length > 0 && (
              <div className="ir-imaging-details">
                <h3>Imaging Details</h3>
                {Object.entries(report.imaging).map(([k, v]) => (
                  <div key={k} className="ir-imaging-details__row">
                    <span className="ir-imaging-details__label">{k}</span>
                    <span>{v ?? "N/A"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}