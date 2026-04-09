"""
report_json_generator.py
========================
Generates structured JSON case data from the same pipeline as medical_report_generation.py.
This is the bridge between the existing PDF pipeline and the new interactive web report.

Output schema:
{
  "case_id": str,
  "patient": { "bdmap_id", "age", "sex" },
  "imaging": { ... },
  "measurements": [ { organ, volume_cc, lesion_count, lesion_volume_cc } ],
  "narrative_report": str,
  "structured_report": str,
  "findings": [
    {
      "id": str,
      "sentence": str,
      "organ": str,
      "finding_type": "lesion"|"measurement"|"observation",
      "linked_image_ids": [str],
      "medical_terms": [ { "term", "definition", "example_note" } ]
    }
  ],
  "key_images": [
    {
      "id": str,
      "organ": str,
      "view_type": "overlay"|"zoomed",
      "slice_index": int,
      "image_data_base64": str,     # PNG base64
      "linked_finding_ids": [str]
    }
  ]
}
"""

import os
import re
import json
import uuid
import base64
import numpy as np
import pandas as pd
import SimpleITK as sitk
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from io import BytesIO
from typing import Optional, Dict, List, Any


# ── Medical terminology dictionary ──────────────────────────────────────────

MEDICAL_GLOSSARY = {
    "hypoattenuating lesion": {
        "definition": "An area that appears darker than surrounding tissue on a contrast-enhanced CT scan, suggesting it absorbs less contrast agent. Often indicates a cyst, necrosis, or tumor.",
        "example_note": "Common in pancreatic ductal adenocarcinoma, where the tumor is poorly vascularized."
    },
    "pancreatic duct dilation": {
        "definition": "Abnormal widening of the main pancreatic duct (normal ≤3 mm in the head). Can indicate downstream obstruction by a mass, stone, or stricture.",
        "example_note": "A dilated duct upstream of a pancreatic head mass is a classic sign of pancreatic cancer."
    },
    "malignant mass": {
        "definition": "A solid tissue growth with imaging features suggesting cancer: irregular borders, invasion of adjacent structures, or associated lymphadenopathy.",
        "example_note": "On CT, malignant masses often show heterogeneous enhancement and loss of fat planes with adjacent organs."
    },
    "hepatic lesion": {
        "definition": "Any focal abnormality within the liver parenchyma. May be benign (cyst, hemangioma) or malignant (metastasis, hepatocellular carcinoma).",
        "example_note": "Multiple small hypoattenuating liver lesions in a cancer patient often suggest metastatic disease."
    },
    "renal lesion": {
        "definition": "A focal abnormality in the kidney. Simple cysts (Bosniak I) are benign; complex or solid lesions may require further workup.",
        "example_note": "A solid enhancing renal mass >1 cm is considered suspicious for renal cell carcinoma until proven otherwise."
    },
    "organ volume": {
        "definition": "The three-dimensional size of an organ measured in cubic centimeters (cc), typically computed from segmentation of cross-sectional imaging.",
        "example_note": "Normal liver volume is approximately 1200–1500 cc in adults."
    },
    "segmentation mask": {
        "definition": "A voxel-wise label map that delineates the boundaries of an organ or lesion in a 3D medical image, produced by AI or manual annotation.",
        "example_note": "AI-generated masks allow automated volume and lesion-count measurements."
    },
    "contrast enhancement": {
        "definition": "The increase in brightness of tissue on CT after intravenous contrast administration, reflecting tissue vascularity and perfusion.",
        "example_note": "Arterial-phase enhancement highlights hypervascular structures; portal-venous phase highlights the liver parenchyma."
    },
    "lymphadenopathy": {
        "definition": "Abnormal enlargement of lymph nodes (short axis >10 mm in most regions), which may indicate infection, inflammation, or metastatic spread.",
        "example_note": "Peripancreatic lymphadenopathy in the setting of a pancreatic mass raises suspicion for nodal metastasis."
    },
    "vascular involvement": {
        "definition": "Encasement or abutment of major blood vessels (e.g., SMA, celiac axis, portal vein) by a tumor, affecting resectability staging.",
        "example_note": ">180° encasement of the SMA typically renders a pancreatic tumor unresectable by the NCCN criteria."
    },
    "pancreatic lesion": {
        "definition": "A focal abnormality in the pancreas, which may represent a neoplasm (PDAC, NET, IPMN), cyst, or inflammatory change.",
        "example_note": "Solid hypodense lesions in the pancreatic head with upstream duct dilation are classic for PDAC."
    },
    "liver lesion": {
        "definition": "Any focal abnormality within the liver. Differential includes hemangioma, cyst, FNH, adenoma, HCC, or metastasis depending on imaging characteristics.",
        "example_note": "Peripheral nodular enhancement with centripetal fill-in is characteristic of hepatic hemangioma."
    },
    "kidney lesion": {
        "definition": "A focal abnormality in the kidney, ranging from simple cysts to complex cystic or solid masses.",
        "example_note": "The Bosniak classification system categorizes renal cystic masses from I (benign) to IV (likely malignant)."
    },
}


def _term_matches_in_text(text: str) -> List[Dict[str, str]]:
    """Find all medical glossary terms present in a sentence."""
    matches = []
    lower = text.lower()
    for term, info in MEDICAL_GLOSSARY.items():
        if term in lower:
            matches.append({"term": term, **info})
    return matches


# ── Image generation (reuses logic from medical_report_generation.py) ────────

def _generate_overlay_png_bytes(ct_path: str, mask_path: str,
                                 contrast_min=-150, contrast_max=250) -> Optional[tuple]:
    """Generate overlay image as PNG bytes + slice index. Returns (bytes, slice_idx) or None."""
    try:
        ct_scan = sitk.ReadImage(ct_path)
        mask = sitk.ReadImage(mask_path)
        ct_scan = sitk.DICOMOrient(ct_scan, "RAS")
        mask = sitk.DICOMOrient(mask, "RAS")
        ct_array = sitk.GetArrayFromImage(ct_scan)
        mask_array = sitk.GetArrayFromImage(mask)
        if ct_array.shape != mask_array.shape:
            return None

        slice_sums = np.sum(mask_array, axis=(1, 2))
        idx = int(np.argmax(slice_sums))
        if slice_sums[idx] == 0:
            return None

        ct_slice = np.fliplr(ct_array[idx])
        mask_slice = np.fliplr(mask_array[idx])

        ct_slice = np.clip(ct_slice, contrast_min, contrast_max)
        ct_slice = ((ct_slice - contrast_min) / (contrast_max - contrast_min) * 255).astype(np.uint8)

        fig, ax = plt.subplots(figsize=(4, 4), dpi=100)
        ax.imshow(ct_slice, cmap="gray", origin="lower")
        ax.contour(mask_slice, colors="red", linewidths=1)
        ax.axis("off")
        buf = BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
        plt.close(fig)
        buf.seek(0)
        return buf.read(), idx
    except Exception:
        return None


def _generate_zoomed_png_bytes(ct_path: str, mask_path: str,
                                contrast_min=-150, contrast_max=250) -> Optional[tuple]:
    """Generate zoomed image as PNG bytes + slice index."""
    try:
        ct_scan = sitk.ReadImage(ct_path)
        mask = sitk.ReadImage(mask_path)
        ct_scan = sitk.DICOMOrient(ct_scan, "RAS")
        mask = sitk.DICOMOrient(mask, "RAS")
        ct_array = sitk.GetArrayFromImage(ct_scan)
        mask_array = sitk.GetArrayFromImage(mask)
        if ct_array.shape != mask_array.shape:
            return None

        slice_sums = np.sum(mask_array, axis=(1, 2))
        idx = int(np.argmax(slice_sums))
        if slice_sums[idx] == 0:
            return None

        mask_slice = mask_array[idx]
        coords = np.array(np.where(mask_slice))
        r0, r1 = int(np.min(coords[0])), int(np.max(coords[0]))
        c0, c1 = int(np.min(coords[1])), int(np.max(coords[1]))
        pad = 20
        r0 = max(r0 - pad, 0)
        r1 = min(r1 + pad, mask_slice.shape[0])
        c0 = max(c0 - pad, 0)
        c1 = min(c1 + pad, mask_slice.shape[1])

        zoomed_ct = np.fliplr(ct_array[idx][r0:r1, c0:c1])
        zoomed_mask = np.fliplr(mask_array[idx][r0:r1, c0:c1])

        zoomed_ct = np.clip(zoomed_ct, contrast_min, contrast_max)
        zoomed_ct = ((zoomed_ct + 150) / 400 * 255).astype(np.uint8)

        fig, ax = plt.subplots(figsize=(4, 4), dpi=100)
        ax.imshow(zoomed_ct, cmap="gray", origin="lower")
        ax.contour(zoomed_mask, colors="red", linewidths=1)
        ax.axis("off")
        buf = BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
        plt.close(fig)
        buf.seek(0)
        return buf.read(), idx
    except Exception:
        return None


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


# ── Findings extraction ──────────────────────────────────────────────────────

def _split_into_findings(narrative: str, structured: str,
                         organ_has_lesions: Dict[str, bool]) -> List[Dict]:
    """
    Parse the narrative/structured report text into individual finding objects.
    Each sentence becomes a finding linked to an organ if detectable.
    """
    findings = []

    organ_keywords = {
        "liver": ["liver", "hepatic"],
        "pancreas": ["pancreas", "pancreatic", "duct dilation", "pdac"],
        "kidney": ["kidney", "renal"],
    }

    # Combine both reports; split on sentence boundaries
    combined = (narrative or "") + "\n" + (structured or "")
    sentences = re.split(r'(?<=[.!?])\s+', combined.strip())

    for sent in sentences:
        sent = sent.strip()
        if len(sent) < 10:
            continue

        # Detect organ
        organ = None
        lower_sent = sent.lower()
        for org, kws in organ_keywords.items():
            if any(kw in lower_sent for kw in kws):
                organ = org
                break

        # Detect finding type
        finding_type = "observation"
        if any(kw in lower_sent for kw in ["lesion", "mass", "tumor", "nodule", "metastas"]):
            finding_type = "lesion"
        elif any(kw in lower_sent for kw in ["volume", "measure", "size", "diameter", "mm", "cc", "cm"]):
            finding_type = "measurement"

        terms = _term_matches_in_text(sent)
        fid = f"f-{uuid.uuid4().hex[:8]}"
        findings.append({
            "id": fid,
            "sentence": sent,
            "organ": organ,
            "finding_type": finding_type,
            "linked_image_ids": [],   # filled later
            "medical_terms": terms,
        })

    return findings


# ── Main generator ───────────────────────────────────────────────────────────

def generate_interactive_report_json(
    case_id: str,
    ct_path: str,
    masks: Optional[Dict[str, str]],
    extracted_data: Optional[pd.Series] = None,
    column_headers: Optional[list] = None,
) -> Dict[str, Any]:
    """
    Produce a full interactive-report JSON structure for a single case.

    Parameters mirror generate_pdf_with_template from medical_report_generation.py.
    """

    # ── Patient info ─────────────────────────────────────────────────────
    patient = {"bdmap_id": case_id, "age": None, "sex": None}
    imaging = {}
    measurements = []
    narrative_report = ""
    structured_report = ""

    if extracted_data is not None:
        patient["age"] = int(extracted_data["age"]) if pd.notna(extracted_data.get("age")) else None
        patient["sex"] = extracted_data["sex"] if pd.notna(extracted_data.get("sex")) else None

        # Imaging details (columns B,C,F,G from original)
        if column_headers and len(column_headers) > 6:
            for ci in [1, 2, 5, 6]:
                if ci < len(column_headers):
                    val = extracted_data.iloc[ci]
                    imaging[column_headers[ci]] = val if pd.notna(val) else None

        # Measurements table
        def _safe(series, idx):
            try:
                v = series.iloc[idx]
                return None if pd.isna(v) else v
            except (IndexError, KeyError):
                return None

        for organ, vol_i, count_i, lvol_i in [
            ("liver", 7, 11, 8),
            ("pancreas", 23, 27, 24),
            ("kidney", 40, 46, 43),
        ]:
            count_val = _safe(extracted_data, count_i)
            measurements.append({
                "organ": organ,
                "volume_cc": _safe(extracted_data, vol_i),
                "lesion_count": int(count_val) if count_val is not None else 0,
                "lesion_volume_cc": _safe(extracted_data, lvol_i),
            })

        narrative_report = str(_safe(extracted_data, 71) or "")
        structured_report = str(_safe(extracted_data, 70) or "")

    # ── Key images ───────────────────────────────────────────────────────
    key_images = []
    organ_has_lesions = {}

    if masks:
        for organ, mask_path in masks.items():
            if not mask_path or not os.path.exists(mask_path):
                organ_has_lesions[organ] = False
                continue

            organ_has_lesions[organ] = True

            overlay_result = _generate_overlay_png_bytes(ct_path, mask_path)
            if overlay_result:
                png_bytes, slice_idx = overlay_result
                img_id = f"img-{organ}-overlay"
                key_images.append({
                    "id": img_id,
                    "organ": organ,
                    "view_type": "overlay",
                    "slice_index": slice_idx,
                    "image_data_base64": _b64(png_bytes),
                    "linked_finding_ids": [],
                })

            zoomed_result = _generate_zoomed_png_bytes(ct_path, mask_path)
            if zoomed_result:
                png_bytes, slice_idx = zoomed_result
                img_id = f"img-{organ}-zoomed"
                key_images.append({
                    "id": img_id,
                    "organ": organ,
                    "view_type": "zoomed",
                    "slice_index": slice_idx,
                    "image_data_base64": _b64(png_bytes),
                    "linked_finding_ids": [],
                })

    # ── Findings ─────────────────────────────────────────────────────────
    findings = _split_into_findings(narrative_report, structured_report, organ_has_lesions)

    # Cross-link findings ↔ images
    for finding in findings:
        if finding["organ"]:
            matching_imgs = [img["id"] for img in key_images if img["organ"] == finding["organ"]]
            finding["linked_image_ids"] = matching_imgs
            for img in key_images:
                if img["organ"] == finding["organ"]:
                    img["linked_finding_ids"].append(finding["id"])

    return {
        "case_id": case_id,
        "patient": patient,
        "imaging": imaging,
        "measurements": measurements,
        "narrative_report": narrative_report,
        "structured_report": structured_report,
        "findings": findings,
        "key_images": key_images,
    }