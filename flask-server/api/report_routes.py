"""
report_routes.py
================
Flask blueprint providing the /api/interactive-report/<id> endpoint.
Returns structured JSON for the interactive radiology report UI.

Register in app.py or api_blueprint.py.
"""

from flask import Blueprint, jsonify, request
import os
import pandas as pd

from constants import Constants
from services.report_json_generator import generate_interactive_report_json, MEDICAL_GLOSSARY
from api.utils import get_panTS_id, get_mask_data_internal

report_blueprint = Blueprint("report", __name__)


@report_blueprint.route("/interactive-report/<case_id>", methods=["GET"])
def get_interactive_report(case_id: str):
    """
    Generate and return the full interactive report JSON for a case.

    Query params:
        include_images=1  (default 1) – set to 0 to omit base64 image data (lighter payload)
    """
    try:
        include_images = request.args.get("include_images", "1") != "0"

        # Resolve paths (same logic as existing get-report endpoint)
        subfolder = "ImageTr" if int(case_id) < 9000 else "ImageTe"
        label_subfolder = "LabelTr" if int(case_id) < 9000 else "LabelTe"

        ct_path = os.path.join(
            Constants.PANTS_PATH, "data", subfolder,
            get_panTS_id(case_id), Constants.MAIN_NIFTI_FILENAME
        )
        masks_dir = os.path.join(
            Constants.PANTS_PATH, "data", label_subfolder,
            get_panTS_id(case_id)
        )

        # Build masks dict from available segmentation files
        masks = {}
        seg_dir = os.path.join(masks_dir, "segmentations")
        organ_mask_files = {
            "liver": "liver_lesion.nii.gz",
            "pancreas": "pancreatic_lesion.nii.gz",
            "kidney": "kidney_lesion.nii.gz",
        }
        for organ, fname in organ_mask_files.items():
            p = os.path.join(seg_dir, fname)
            if os.path.exists(p):
                masks[organ] = p

        # Also check for combined labels if segmentations dir doesn't exist
        if not masks:
            combined_path = os.path.join(masks_dir, Constants.COMBINED_LABELS_NIFTI_FILENAME)
            if os.path.exists(combined_path):
                masks["combined"] = combined_path

        # Try to load extracted CSV data
        extracted_data = None
        column_headers = None
        base_path = os.path.join(os.path.dirname(__file__), "..", "..", "tmp", case_id)
        csv_path = os.path.join(base_path, "info.csv")
        try:
            if os.path.exists(csv_path):
                df = pd.read_csv(csv_path)
                if len(df) > 0:
                    extracted_data = df.iloc[0]
                    column_headers = df.columns.tolist()
        except Exception:
            pass

        report_json = generate_interactive_report_json(
            case_id=case_id,
            ct_path=ct_path,
            masks=masks if masks else None,
            extracted_data=extracted_data,
            column_headers=column_headers,
        )

        # Inject real CT slice images from NIfTI volumes if key_images are empty
        if include_images:
            has_any_image = any(
                img.get("image_data_base64") for img in report_json.get("key_images", [])
            )
            if not has_any_image:
                try:
                    from services.slice_image_generator import generate_ai_analysis_images
                    real = generate_ai_analysis_images(case_id)
                    organs_data = real.get("organs", {})

                    # Build key_images from real slice data
                    new_images = []
                    for organ_name, organ_info in organs_data.items():
                        if not isinstance(organ_info, dict):
                            continue
                        loc = organ_info.get("localize")
                        if loc and loc.get("base64"):
                            img_id = f"img-{organ_name}-overlay"
                            new_images.append({
                                "id": img_id,
                                "organ": organ_name,
                                "view_type": "overlay",
                                "slice_index": loc.get("slice_index", 0),
                                "image_data_base64": loc["base64"],
                                "linked_finding_ids": [],
                            })
                        det = organ_info.get("detect") or organ_info.get("lesion")
                        if det and det.get("base64"):
                            img_id = f"img-{organ_name}-zoomed"
                            new_images.append({
                                "id": img_id,
                                "organ": organ_name,
                                "view_type": "zoomed",
                                "slice_index": det.get("slice_index", 0),
                                "image_data_base64": det["base64"],
                                "linked_finding_ids": [],
                            })

                    if new_images:
                        report_json["key_images"] = new_images
                        # Re-link findings to images
                        for finding in report_json.get("findings", []):
                            organ = finding.get("organ")
                            if organ:
                                matching = [img["id"] for img in new_images if img["organ"] == organ]
                                finding["linked_image_ids"] = matching
                        for img in new_images:
                            linked = [f["id"] for f in report_json.get("findings", []) if f.get("organ") == img["organ"]]
                            img["linked_finding_ids"] = linked
                except Exception:
                    pass  # Fall through with whatever images we have
        else:
            for img in report_json.get("key_images", []):
                img.pop("image_data_base64", None)

        return jsonify(report_json)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@report_blueprint.route("/medical-glossary", methods=["GET"])
def get_medical_glossary():
    """Return the full medical glossary for client-side term lookup."""
    return jsonify(MEDICAL_GLOSSARY)


def _generate_demo_image(organ: str, view_type: str) -> str:
    """Generate a synthetic CT-like demo image as base64 PNG."""
    import numpy as np
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from io import BytesIO
    import base64

    np.random.seed(hash(organ + view_type) % 2**31)
    size = 200 if view_type == "zoomed" else 256

    # Create synthetic CT-like background
    bg = np.random.normal(80, 15, (size, size)).astype(np.float32)
    # Add a circular "organ" region
    y, x = np.ogrid[-size//2:size//2, -size//2:size//2]
    organ_radius = size // 3
    organ_mask = x**2 + y**2 < organ_radius**2
    bg[organ_mask] += 40

    # Add a "lesion" (darker spot)
    lesion_cx, lesion_cy = size//2 + size//8, size//2 - size//10
    lesion_r = size // 10 if view_type == "overlay" else size // 6
    lesion_mask = (x - (lesion_cx - size//2))**2 + (y - (lesion_cy - size//2))**2 < lesion_r**2
    bg[lesion_mask] -= 35

    bg = np.clip(bg, 0, 255).astype(np.uint8)

    # Color for contour by organ
    colors = {"pancreas": "red", "liver": "orange", "kidney": "royalblue"}
    color = colors.get(organ, "red")

    fig, ax = plt.subplots(figsize=(3, 3), dpi=100)
    ax.imshow(bg, cmap="gray", origin="lower")
    ax.contour(lesion_mask.astype(float), colors=color, linewidths=1.5)
    if view_type == "overlay":
        ax.contour(organ_mask.astype(float), colors="yellow", linewidths=0.8, linestyles="dashed")
    ax.axis("off")
    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0, facecolor="black")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")


@report_blueprint.route("/interactive-report-demo", methods=["GET"])
def get_demo_report():
    """
    Return a fully-populated demo report for frontend development
    when real CT data is not available.
    """
    demo = {
        "case_id": "DEMO_001",
        "patient": {"bdmap_id": "DEMO_001", "age": 67, "sex": "M"},
        "imaging": {
            "Modality": "CT Abdomen with IV Contrast",
            "Phase": "Portal Venous",
            "Spacing": "[0.7, 0.7, 1.5]",
            "Manufacturer": "Siemens SOMATOM"
        },
        "measurements": [
            {"organ": "liver", "volume_cc": 1423.5, "lesion_count": 2, "lesion_volume_cc": 8.3},
            {"organ": "pancreas", "volume_cc": 72.1, "lesion_count": 1, "lesion_volume_cc": 3.7},
            {"organ": "kidney", "volume_cc": 312.4, "lesion_count": 0, "lesion_volume_cc": 0},
        ],
        "narrative_report": (
            "A 67-year-old male presents for abdominal CT with IV contrast. "
            "A small hypoattenuating lesion is present in the head of the pancreas, "
            "measuring approximately 2.1 cm in maximum diameter. "
            "There is associated pancreatic duct dilation measuring 5 mm in the body and tail. "
            "The liver demonstrates two sub-centimeter hypoattenuating lesions in segments VI and VII, "
            "which are too small to characterize but may represent cysts or metastases. "
            "The kidneys are normal in size and enhancement without evidence of renal lesion. "
            "No lymphadenopathy is identified. "
            "The aorta and major branches are patent without significant atherosclerotic disease. "
            "There is no free fluid in the abdomen or pelvis."
        ),
        "structured_report": (
            "PANCREAS: Hypoattenuating lesion in the pancreatic head, 2.1 cm. "
            "Upstream pancreatic duct dilation to 5 mm. No vascular involvement of SMA or celiac axis. "
            "LIVER: Two sub-centimeter hypoattenuating lesions in segments VI and VII. "
            "Organ volume 1423.5 cc within normal limits. "
            "KIDNEYS: Unremarkable. No renal lesion identified. "
            "LYMPH NODES: No pathologic lymphadenopathy. "
            "IMPRESSION: Findings suspicious for pancreatic ductal adenocarcinoma. "
            "Recommend endoscopic ultrasound with FNA for tissue diagnosis."
        ),
        "findings": [
            {
                "id": "f-demo-001",
                "sentence": "A small hypoattenuating lesion is present in the head of the pancreas, measuring approximately 2.1 cm in maximum diameter.",
                "organ": "pancreas",
                "finding_type": "lesion",
                "linked_image_ids": ["img-pancreas-overlay", "img-pancreas-zoomed"],
                "medical_terms": [
                    {
                        "term": "hypoattenuating lesion",
                        "definition": "An area that appears darker than surrounding tissue on a contrast-enhanced CT scan, suggesting it absorbs less contrast agent.",
                        "example_note": "Common in pancreatic ductal adenocarcinoma, where the tumor is poorly vascularized."
                    }
                ]
            },
            {
                "id": "f-demo-002",
                "sentence": "There is associated pancreatic duct dilation measuring 5 mm in the body and tail.",
                "organ": "pancreas",
                "finding_type": "measurement",
                "linked_image_ids": ["img-pancreas-overlay", "img-pancreas-zoomed"],
                "medical_terms": [
                    {
                        "term": "pancreatic duct dilation",
                        "definition": "Abnormal widening of the main pancreatic duct (normal ≤3 mm in the head).",
                        "example_note": "A dilated duct upstream of a pancreatic head mass is a classic sign of pancreatic cancer."
                    }
                ]
            },
            {
                "id": "f-demo-003",
                "sentence": "The liver demonstrates two sub-centimeter hypoattenuating lesions in segments VI and VII, which are too small to characterize but may represent cysts or metastases.",
                "organ": "liver",
                "finding_type": "lesion",
                "linked_image_ids": ["img-liver-overlay", "img-liver-zoomed"],
                "medical_terms": [
                    {
                        "term": "hepatic lesion",
                        "definition": "Any focal abnormality within the liver parenchyma.",
                        "example_note": "Multiple small hypoattenuating liver lesions in a cancer patient often suggest metastatic disease."
                    }
                ]
            },
            {
                "id": "f-demo-004",
                "sentence": "The kidneys are normal in size and enhancement without evidence of renal lesion.",
                "organ": "kidney",
                "finding_type": "observation",
                "linked_image_ids": [],
                "medical_terms": []
            },
            {
                "id": "f-demo-005",
                "sentence": "No lymphadenopathy is identified.",
                "organ": None,
                "finding_type": "observation",
                "linked_image_ids": [],
                "medical_terms": [
                    {
                        "term": "lymphadenopathy",
                        "definition": "Abnormal enlargement of lymph nodes (short axis >10 mm).",
                        "example_note": "Peripancreatic lymphadenopathy in the setting of a pancreatic mass raises suspicion for nodal metastasis."
                    }
                ]
            },
            {
                "id": "f-demo-006",
                "sentence": "Findings suspicious for pancreatic ductal adenocarcinoma. Recommend endoscopic ultrasound with FNA for tissue diagnosis.",
                "organ": "pancreas",
                "finding_type": "observation",
                "linked_image_ids": ["img-pancreas-overlay", "img-pancreas-zoomed"],
                "medical_terms": [
                    {
                        "term": "malignant mass",
                        "definition": "A solid tissue growth with imaging features suggesting cancer.",
                        "example_note": "On CT, malignant masses often show heterogeneous enhancement and loss of fat planes."
                    }
                ]
            },
        ],
        "key_images": [
            {
                "id": "img-pancreas-overlay",
                "organ": "pancreas",
                "view_type": "overlay",
                "slice_index": 142,
                "image_data_base64": _generate_demo_image("pancreas", "overlay"),
                "linked_finding_ids": ["f-demo-001", "f-demo-002", "f-demo-006"]
            },
            {
                "id": "img-pancreas-zoomed",
                "organ": "pancreas",
                "view_type": "zoomed",
                "slice_index": 142,
                "image_data_base64": _generate_demo_image("pancreas", "zoomed"),
                "linked_finding_ids": ["f-demo-001", "f-demo-002", "f-demo-006"]
            },
            {
                "id": "img-liver-overlay",
                "organ": "liver",
                "view_type": "overlay",
                "slice_index": 98,
                "image_data_base64": _generate_demo_image("liver", "overlay"),
                "linked_finding_ids": ["f-demo-003"]
            },
            {
                "id": "img-liver-zoomed",
                "organ": "liver",
                "view_type": "zoomed",
                "slice_index": 98,
                "image_data_base64": _generate_demo_image("liver", "zoomed"),
                "linked_finding_ids": ["f-demo-003"]
            },
        ],
    }
    return jsonify(demo)


@report_blueprint.route("/ai-analysis-images/<case_id>", methods=["GET"])
def get_ai_analysis_images(case_id: str):
    """
    Generate real CT slice images with segmentation overlays for the AI Analysis page.
    Uses actual NIfTI volumes from the PanTS dataset.
    """
    try:
        from services.slice_image_generator import generate_ai_analysis_images
        result = generate_ai_analysis_images(case_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e), "case_id": case_id, "organs": {}}), 500