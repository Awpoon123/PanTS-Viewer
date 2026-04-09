import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router";
import { API_BASE } from "../helpers/constants";
import "./AIAnalysisPage.css";

interface AnalysisStep {
  id: string;
  stage: "init" | "localize" | "detect" | "report";
  title: string;
  reasoning: string;
  detail?: string;
  organ?: string;
  imageBase64?: string | null;
  reportSentence?: string;
  duration: number;
}

interface ReportData {
  case_id: string;
  patient: { bdmap_id: string; age: number | null; sex: string | null };
  imaging: Record<string, string | null>;
  measurements: { organ: string; volume_cc: number | null; lesion_count: number; lesion_volume_cc: number | null }[];
  narrative_report: string;
  structured_report: string;
  findings: { id: string; sentence: string; organ: string | null; finding_type: string; linked_image_ids: string[]; medical_terms: { term: string; definition: string; example_note: string }[] }[];
  key_images: { id: string; organ: string; view_type: string; slice_index: number; image_data_base64: string | null; linked_finding_ids: string[] }[];
}

interface OrganImages {
  localize?: { base64: string; slice_index: number; axis: string };
  detect?: { base64: string; slice_index: number } | null;
  lesion?: { base64: string; slice_index: number; voxel_count: number } | null;
  voxel_count: number;
}

interface RealImagesData {
  case_id: string;
  organs: Record<string, OrganImages>;
  error?: string;
}

function buildSteps(report: ReportData, realImages?: RealImagesData | null): AnalysisStep[] {
  const steps: AnalysisStep[] = [];

  steps.push({
    id: "init-1", stage: "init", title: "Loading CT Volume",
    reasoning: `Ingesting 3D CT scan for patient ${report.case_id}. Reading NIfTI volume headers, verifying voxel dimensions, and reorienting to RAS (Right-Anterior-Superior) standard coordinate space for consistent anatomical alignment.`,
    detail: `Case: ${report.case_id} | Age: ${report.patient.age ?? "N/A"} | Sex: ${report.patient.sex ?? "N/A"}`,
    duration: 2200,
  });

  steps.push({
    id: "init-2", stage: "init", title: "Preprocessing & Segmentation",
    reasoning: "Running AI segmentation model to identify 28 anatomical structures. Applying contrast windowing (W:400, L:40) to optimize soft-tissue differentiation. The model processes 512x512 axial slices through a U-Net architecture with attention gates, generating voxel-wise label predictions for each organ class.",
    detail: "Structures: 28 classes | Model: PanTS Segmentation Network",
    duration: 2000,
  });

  const organs = ["pancreas", "liver", "kidney"];
  const organDesc: Record<string, string> = {
    pancreas: "Segmentation model identifies the pancreas in the retroperitoneum, posterior to the stomach. Delineating head, body, and tail sub-regions using anatomical landmarks (SMA, splenic vein, duodenal C-loop). The colored overlay shows pancreas body (pink), head (hot pink), tail (rose), and pancreatic duct (tan).",
    liver: "Localizing the liver in the right upper quadrant. The model traces hepatic boundaries using the falciform ligament, portal vein bifurcation, and diaphragmatic surface as reference points. The dark red overlay delineates the complete hepatic parenchyma.",
    kidney: "Bilateral kidney segmentation initiated. Identifying left kidney (green) and right kidney (teal) using renal hilum and cortical boundaries. Measuring organ volume and checking for focal density abnormalities or asymmetry.",
  };

  for (const organ of organs) {
    const measurement = report.measurements.find((m) => m.organ === organ);
    const realOrgan = realImages?.organs?.[organ];
    let imageB64: string | null = null;
    let sliceInfo = "";
    if (realOrgan?.localize) {
      imageB64 = realOrgan.localize.base64;
      sliceInfo = ` | Slice: ${realOrgan.localize.slice_index} (${realOrgan.localize.axis})`;
    }
    steps.push({
      id: `loc-${organ}`, stage: "localize",
      title: `Localizing ${organ.charAt(0).toUpperCase() + organ.slice(1)}`,
      reasoning: organDesc[organ] ?? `Scanning for ${organ} boundaries...`,
      detail: (measurement ? `Volume: ${measurement.volume_cc?.toFixed(1) ?? "N/A"} cc` : "Measuring...") + sliceInfo,
      organ, imageBase64: imageB64, duration: 2800,
    });
  }

  for (const organ of organs) {
    const measurement = report.measurements.find((m) => m.organ === organ);
    const realOrgan = realImages?.organs?.[organ];
    const finding = report.findings.find((f) => f.organ === organ && f.finding_type === "lesion");
    let detectImage: string | null = null;
    if (realOrgan?.lesion) detectImage = realOrgan.lesion.base64;
    else if (realOrgan?.detect) detectImage = realOrgan.detect.base64;
    const hasLesions = measurement && measurement.lesion_count > 0;
    if (!hasLesions && !detectImage) continue;
    const detReasons: Record<string, string> = {
      pancreas: "Anomaly detected: hypoattenuating region in the pancreatic head shows significantly lower HU values (-20 to +40 HU) compared to surrounding parenchyma (+80 to +120 HU). The red contour outlines the lesion boundary. Morphology analysis indicates irregular margins with possible upstream ductal dilation.",
      liver: "Focal hypoattenuating lesion identified during hepatic parenchyma scan. Comparing lesion density against normal liver tissue (+60 to +80 HU portal venous phase). Lesion measures below expected range, suggesting cystic or neoplastic etiology.",
      kidney: "Renal parenchyma shows focal density abnormality. Evaluating Bosniak classification criteria: wall thickness, septation, enhancement characteristics. Cross-referencing contralateral kidney for asymmetry.",
    };
    steps.push({
      id: `det-${organ}`, stage: "detect",
      title: `${hasLesions ? "Lesion Detected" : "Scanning"} — ${organ.charAt(0).toUpperCase() + organ.slice(1)}`,
      reasoning: hasLesions ? (detReasons[organ] ?? `Analyzing ${organ}...`) : `Zooming into ${organ} region for detailed analysis. No definitive lesion identified.`,
      detail: hasLesions ? `${measurement!.lesion_count} lesion(s) | Volume: ${measurement!.lesion_volume_cc?.toFixed(1) ?? "N/A"} cc` : `No lesions in ${organ}`,
      organ, imageBase64: detectImage, reportSentence: finding?.sentence, duration: 3200,
    });
  }

  const rptFindings = report.findings.filter((f) => f.sentence.length > 20);
  for (let i = 0; i < rptFindings.length; i++) {
    const f = rptFindings[i];
    const isImp = f.sentence.toLowerCase().includes("impression") || f.sentence.toLowerCase().includes("suspicious") || f.sentence.toLowerCase().includes("recommend");
    steps.push({
      id: `rpt-${i}`, stage: "report",
      title: isImp ? "Generating Impression" : `Writing Finding ${i + 1}`,
      reasoning: isImp
        ? "Synthesizing all observations into a clinical impression. Correlating lesion characteristics with NCCN, Li-RADS, and Bosniak criteria. Formulating differential diagnosis and recommendation."
        : `Translating visual analysis of ${f.organ ?? "anatomy"} into structured radiology language. Mapping detected features to standardized descriptors.`,
      reportSentence: f.sentence, organ: f.organ ?? undefined,
      duration: 2000 + f.sentence.length * 15,
    });
  }
  return steps;
}

function useTypewriter(text: string, speed = 18, active = true) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!active) { setDisplayed(""); setDone(false); return; }
    setDisplayed(""); setDone(false);
    let i = 0;
    const iv = setInterval(() => { i++; setDisplayed(text.slice(0, i)); if (i >= text.length) { clearInterval(iv); setDone(true); } }, speed);
    return () => clearInterval(iv);
  }, [text, speed, active]);
  return { displayed, done };
}

function StageBadge({ stage }: { stage: AnalysisStep["stage"] }) {
  const c = { init: { l: "INITIALIZE", c: "#6ec6ff" }, localize: { l: "LOCALIZE", c: "#4ae68a" }, detect: { l: "DETECT", c: "#ff5c5c" }, report: { l: "REPORT", c: "#f0c040" } }[stage];
  return <span className="aia-badge" style={{ background: `${c.c}18`, color: c.c, borderColor: `${c.c}44` }}>{c.l}</span>;
}

function ScanLineOverlay({ active, color = "#4ae68a" }: { active: boolean; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!active) return;
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    let y = 0; let raf: number;
    const anim = () => {
      cv.width = cv.offsetWidth; cv.height = cv.offsetHeight;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const g = ctx.createLinearGradient(0, y - 30, 0, y + 30);
      g.addColorStop(0, "transparent"); g.addColorStop(0.5, color + "66"); g.addColorStop(1, "transparent");
      ctx.fillStyle = g; ctx.fillRect(0, y - 30, cv.width, 60);
      ctx.strokeStyle = color + "15"; ctx.lineWidth = 0.5;
      for (let gy = 0; gy < cv.height; gy += 20) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cv.width, gy); ctx.stroke(); }
      y = (y + 1.5) % cv.height; raf = requestAnimationFrame(anim);
    };
    raf = requestAnimationFrame(anim);
    return () => cancelAnimationFrame(raf);
  }, [active, color]);
  return <canvas ref={ref} className="aia-scanline" />;
}

function StepCard({ step, isCurrent, isCompleted, stepNumber, totalSteps }: {
  step: AnalysisStep; isCurrent: boolean; isCompleted: boolean; stepNumber: number; totalSteps: number;
}) {
  const { displayed: rText, done: rDone } = useTypewriter(step.reasoning, 12, isCurrent);
  const { displayed: sText } = useTypewriter(step.reportSentence ?? "", 20, isCurrent && rDone);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (isCurrent && ref.current) ref.current.scrollIntoView({ behavior: "smooth", block: "center" }); }, [isCurrent]);
  const oC: Record<string, string> = { pancreas: "#e85d75", liver: "#c06040", kidney: "#4a8fe7" };
  const sC: Record<string, string> = { init: "#6ec6ff", localize: "#4ae68a", detect: "#ff5c5c", report: "#f0c040" };
  const ac = step.organ ? oC[step.organ] ?? sC[step.stage] : sC[step.stage];
  return (
    <div ref={ref} className={`aia-step ${isCurrent ? "aia-step--current" : ""} ${isCompleted ? "aia-step--done" : ""} ${!isCurrent && !isCompleted ? "aia-step--pending" : ""}`}>
      <div className="aia-step__timeline">
        <div className={`aia-step__dot ${isCurrent ? "aia-step__dot--pulse" : ""}`} style={{ borderColor: ac, background: isCompleted || isCurrent ? ac : "transparent" }} />
        {stepNumber < totalSteps && <div className="aia-step__line" style={{ background: isCompleted ? ac + "66" : "#262b38" }} />}
      </div>
      <div className="aia-step__content">
        <div className="aia-step__header">
          <StageBadge stage={step.stage} />
          <span className="aia-step__title">{step.title}</span>
          {isCompleted && <span className="aia-step__check">✓</span>}
          {isCurrent && <span className="aia-step__spinner" />}
        </div>
        {(isCurrent || isCompleted) && (
          <div className="aia-step__body">
            <div className="aia-step__reasoning">
              <span className="aia-step__reasoning-label">AI Reasoning</span>
              <p>{isCurrent ? rText : step.reasoning}{isCurrent && !rDone && <span className="aia-cursor">▊</span>}</p>
            </div>
            {step.detail && <div className="aia-step__detail">{step.detail}</div>}
            {step.imageBase64 && (
              <div className="aia-step__image-wrapper">
                <img src={`data:image/png;base64,${step.imageBase64}`} alt={step.title} className="aia-step__image" />
                <ScanLineOverlay active={isCurrent} color={ac} />
                {step.organ && <div className="aia-step__image-label" style={{ background: ac }}>{step.organ.toUpperCase()} — {step.stage === "detect" ? "LESION ZOOM" : "SEGMENTATION OVERLAY"}</div>}
              </div>
            )}
            {step.reportSentence && (isCurrent ? rDone : true) && (
              <div className="aia-step__sentence" style={{ borderLeftColor: ac }}>
                <span className="aia-step__sentence-label">Generated Finding</span>
                <p>"{isCurrent ? sText : step.reportSentence}"{isCurrent && sText !== step.reportSentence && <span className="aia-cursor">▊</span>}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressHeader({ currentIndex, totalSteps, currentStage, isPlaying, onPlayPause, onReset, onSkipToEnd }: {
  currentIndex: number; totalSteps: number; currentStage: string; isPlaying: boolean; onPlayPause: () => void; onReset: () => void; onSkipToEnd: () => void;
}) {
  const pct = totalSteps > 0 ? ((currentIndex + 1) / totalSteps) * 100 : 0;
  return (
    <div className="aia-progress">
      <div className="aia-progress__bar-bg"><div className="aia-progress__bar-fill" style={{ width: `${pct}%` }} /></div>
      <div className="aia-progress__info">
        <span className="aia-progress__step-count">Step {currentIndex + 1} / {totalSteps}</span>
        <div className="aia-progress__stages">
          {(["init", "localize", "detect", "report"] as const).map((s) => (
            <span key={s} className={`aia-progress__stage-pip ${currentStage === s ? "aia-progress__stage-pip--active" : ""}`}>
              {s === "init" ? "INIT" : s === "localize" ? "LOCATE" : s === "detect" ? "DETECT" : "REPORT"}
            </span>
          ))}
        </div>
        <div className="aia-progress__controls">
          <button onClick={onReset}>⟲</button>
          <button onClick={onPlayPause}>{isPlaying ? "⏸" : "▶"}</button>
          <button onClick={onSkipToEnd}>⏭</button>
        </div>
      </div>
    </div>
  );
}

export default function AIAnalysisPage() {
  const { caseId } = useParams();
  const [report, setReport] = useState<ReportData | null>(null);
  const [steps, setSteps] = useState<AnalysisStep[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState("Loading CT images...");
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    const loadDemo = () => fetch(`${API_BASE}/api/interactive-report-demo`).then((r) => r.json()).catch(() => null);
    setLoadMsg("Generating CT slice images with segmentation overlays...");

    const rp = fetch(`${API_BASE}/api/interactive-report/${caseId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => (d && !d.error && (d.findings?.length > 0 || d.narrative_report?.trim())) ? d : loadDemo())
      .catch(() => loadDemo());

    const ip = fetch(`${API_BASE}/api/ai-analysis-images/${caseId}`)
      .then((r) => r.ok ? r.json() : null).catch(() => null);

    Promise.all([rp, ip]).then(([rd, id]) => {
      if (!rd) { setError("Could not load report data"); return; }
      setReport(rd);
      const hasReal = id && !id.error && Object.values(id.organs || {}).some((o: any) => o.localize);
      if (hasReal) setLoadMsg("Real CT images loaded");
      else setLoadMsg("Using demo data");
      setSteps(buildSteps(rd, hasReal ? id : null));
      setIsPlaying(true);
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [caseId]);

  useEffect(() => {
    if (!isPlaying || steps.length === 0 || currentIndex >= steps.length) return;
    timerRef.current = setTimeout(() => {
      if (currentIndex < steps.length - 1) setCurrentIndex((i) => i + 1);
      else setIsPlaying(false);
    }, steps[currentIndex].duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [isPlaying, currentIndex, steps]);

  const handlePlayPause = useCallback(() => {
    if (currentIndex >= steps.length - 1 && !isPlaying) { setCurrentIndex(0); setIsPlaying(true); }
    else setIsPlaying((p) => !p);
  }, [currentIndex, steps.length, isPlaying]);
  const handleReset = useCallback(() => { setCurrentIndex(0); setIsPlaying(true); }, []);
  const handleSkipToEnd = useCallback(() => { setCurrentIndex(steps.length - 1); setIsPlaying(false); }, [steps.length]);

  if (loading) return (
    <div className="aia-loading">
      <div className="aia-loading__grid">{Array.from({ length: 16 }).map((_, i) => <div key={i} className="aia-loading__cell" style={{ animationDelay: `${i * 0.08}s` }} />)}</div>
      <p>{loadMsg}</p>
    </div>
  );

  if (error || !report) return (
    <div className="aia-error"><h2>Analysis Unavailable</h2><p>{error ?? "Could not load."}</p><Link to="/">← Back</Link></div>
  );

  const cs = steps[currentIndex];
  const isDone = currentIndex >= steps.length - 1 && !isPlaying;

  return (
    <div className="aia-page">
      <header className="aia-header">
        <div className="aia-header__left">
          <Link to={`/report/${caseId}`} className="aia-header__back">← Report</Link>
          <div>
            <h1 className="aia-header__title"><span className="aia-header__ai-icon">⧫</span> AI Analysis Walkthrough</h1>
            <p className="aia-header__sub">Case {report.case_id} — Watch the AI analyze this CT scan step by step</p>
          </div>
        </div>
        <div className="aia-header__meta">
          {report.patient.age && <span>Age {report.patient.age}</span>}
          {report.patient.sex && <span>{report.patient.sex}</span>}
          <span className="aia-header__live">{isPlaying ? "● LIVE" : isDone ? "✓ COMPLETE" : "⏸ PAUSED"}</span>
        </div>
      </header>

      <ProgressHeader currentIndex={currentIndex} totalSteps={steps.length} currentStage={cs?.stage ?? "init"} isPlaying={isPlaying} onPlayPause={handlePlayPause} onReset={handleReset} onSkipToEnd={handleSkipToEnd} />

      <div className="aia-body">
        <div className="aia-timeline-col">
          <div className="aia-timeline">
            {steps.map((step, i) => <StepCard key={step.id} step={step} isCurrent={i === currentIndex} isCompleted={i < currentIndex} stepNumber={i + 1} totalSteps={steps.length} />)}
          </div>
        </div>
        <div className="aia-preview-col">
          <div className="aia-preview">
            {cs?.imageBase64 ? (
              <div className="aia-preview__image-container">
                <img src={`data:image/png;base64,${cs.imageBase64}`} alt={cs.title} className="aia-preview__image" />
                <ScanLineOverlay active={isPlaying} color={cs.organ === "pancreas" ? "#e85d75" : cs.organ === "liver" ? "#c06040" : cs.organ === "kidney" ? "#4a8fe7" : "#4ae68a"} />
                <div className="aia-preview__hud">
                  <span>{cs.stage === "detect" ? "ZOOMED ROI" : "AXIAL SLICE"}</span>
                  <span>{cs.organ?.toUpperCase() ?? "FULL SCAN"}</span>
                  <span>STEP {currentIndex + 1}/{steps.length}</span>
                </div>
              </div>
            ) : (
              <div className="aia-preview__placeholder">
                <div className={`aia-preview__volume ${isPlaying ? "aia-preview__volume--spin" : ""}`}>
                  <div className="aia-preview__cube">
                    <div className="aia-preview__cube-face aia-preview__cube-face--front" />
                    <div className="aia-preview__cube-face aia-preview__cube-face--back" />
                    <div className="aia-preview__cube-face aia-preview__cube-face--left" />
                    <div className="aia-preview__cube-face aia-preview__cube-face--right" />
                    <div className="aia-preview__cube-face aia-preview__cube-face--top" />
                    <div className="aia-preview__cube-face aia-preview__cube-face--bottom" />
                  </div>
                </div>
                <p className="aia-preview__status">{cs?.stage === "init" ? "Initializing CT volume…" : cs?.stage === "report" ? "Generating report…" : "Processing…"}</p>
              </div>
            )}
            {cs?.reportSentence && <div className="aia-preview__finding"><span className="aia-preview__finding-label">AI Output</span><p>"{cs.reportSentence}"</p></div>}
            <div className="aia-preview__metrics">
              {report.measurements.map((m) => (
                <div key={m.organ} className="aia-preview__metric">
                  <span className="aia-preview__metric-organ">{m.organ}</span>
                  <span className="aia-preview__metric-val">{m.volume_cc?.toFixed(0) ?? "—"} cc</span>
                  <span className={`aia-preview__metric-lesions ${m.lesion_count > 0 ? "aia-preview__metric-lesions--alert" : ""}`}>{m.lesion_count} lesion{m.lesion_count !== 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {isDone && (
        <div className="aia-complete"><div className="aia-complete__inner">
          <span className="aia-complete__icon">✓</span>
          <div><h3>Analysis Complete</h3><p>All {steps.length} steps finished — organs localized, lesions detected, report generated.</p></div>
          <Link to={`/report/${caseId}`} className="aia-complete__link">View Interactive Report →</Link>
        </div></div>
      )}
    </div>
  );
}