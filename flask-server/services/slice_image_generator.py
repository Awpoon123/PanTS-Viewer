"""
slice_image_generator.py
========================
Generates real CT slice images with colored segmentation overlays
from the actual NIfTI volumes in the PanTS dataset.

Uses the same label map and color scheme as the VisualizationPage.
"""

import numpy as np
import nibabel as nib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from io import BytesIO
import base64
import os
from constants import Constants
from api.utils import get_panTS_id

# ── Color map matching segmentation_category_colors in constants.ts ──────
# Label index → RGBA (0-255). Index = PREDEFINED_LABELS key + 1 (since
# Cornerstone uses 1-indexed labels in combined_labels.nii.gz)
LABEL_COLORS = {
    1:  (255, 140, 0),      # adrenal_gland_left
    2:  (255, 165, 0),      # adrenal_gland_right
    3:  (255, 0, 0),        # aorta
    4:  (0, 191, 255),      # bladder
    5:  (220, 20, 60),      # celiac_artery
    6:  (255, 160, 202),    # colon
    7:  (34, 139, 34),      # common_bile_duct
    8:  (255, 127, 80),     # duodenum
    9:  (245, 245, 245),    # femur_left
    10: (220, 220, 220),    # femur_right
    11: (0, 128, 0),        # gall_bladder
    12: (68, 229, 133),     # kidney_left
    13: (68, 229, 181),     # kidney_right
    14: (178, 34, 34),      # liver
    15: (68, 181, 229),     # lung_left
    16: (68, 133, 229),     # lung_right
    17: (255, 182, 193),    # pancreas (body)
    18: (255, 105, 180),    # pancreas (head)
    19: (219, 112, 147),    # pancreas (tail)
    20: (255, 160, 122),    # pancreas general
    21: (255, 228, 181),    # pancreatic_duct
    22: (139, 0, 0),        # pancreatic_lesion
    23: (72, 61, 139),      # postcava
    24: (255, 105, 180),    # prostate
    25: (138, 43, 226),     # spleen
    26: (255, 99, 71),      # stomach
    27: (255, 69, 0),       # superior_mesenteric_artery
    28: (106, 90, 205),     # veins
}

# Organ groups for the AI analysis stages
ORGAN_GROUPS = {
    "pancreas": {
        "labels": [17, 18, 19, 20, 21, 22],  # body, head, tail, general, duct, lesion
        "highlight_color": (232, 93, 117),
        "lesion_labels": [22],
    },
    "liver": {
        "labels": [14],
        "highlight_color": (178, 34, 34),
        "lesion_labels": [],
    },
    "kidney": {
        "labels": [12, 13],
        "highlight_color": (74, 143, 231),
        "lesion_labels": [],
    },
}


def _load_case_volumes(case_id: str):
    """Load CT and segmentation volumes for a case. Returns (ct_array, seg_array, affine) or None."""
    subfolder = "ImageTr" if int(case_id) < 9000 else "ImageTe"
    label_subfolder = "LabelTr" if int(case_id) < 9000 else "LabelTe"
    pants_id = get_panTS_id(case_id)

    ct_path = os.path.join(Constants.PANTS_PATH, "data", subfolder, pants_id, Constants.MAIN_NIFTI_FILENAME)
    seg_path = os.path.join(Constants.PANTS_PATH, "data", label_subfolder, pants_id, Constants.COMBINED_LABELS_NIFTI_FILENAME)

    if not os.path.exists(ct_path):
        return None
    if not os.path.exists(seg_path):
        return None

    ct_img = nib.load(ct_path)
    seg_img = nib.load(seg_path)

    ct_data = ct_img.get_fdata()
    seg_data = np.around(seg_img.get_fdata()).astype(np.uint8)

    return ct_data, seg_data, ct_img.affine


def _find_best_slice(seg_data, label_ids, axis=2):
    """Find the slice along `axis` with the most voxels of the given labels."""
    mask = np.isin(seg_data, label_ids)
    sums = mask.sum(axis=tuple(i for i in range(3) if i != axis))
    best = int(np.argmax(sums))
    return best, int(sums[best])


def _render_slice_with_overlay(ct_data, seg_data, slice_idx, axis=2,
                                window_center=40, window_width=400,
                                highlight_labels=None, alpha=0.45, figsize=(4, 4), dpi=120):
    """
    Render a single CT slice with colored segmentation overlay.
    Returns PNG bytes.
    """
    # Extract slice
    ct_slice = np.take(ct_data, slice_idx, axis=axis)
    seg_slice = np.take(seg_data, slice_idx, axis=axis)

    # Orient: rotate and flip to match the VisualizationPage display
    ct_slice = np.rot90(ct_slice, k=1)
    ct_slice = np.flip(ct_slice, axis=0)
    seg_slice = np.rot90(seg_slice, k=1)
    seg_slice = np.flip(seg_slice, axis=0)

    # Apply windowing
    low = window_center - window_width / 2
    high = window_center + window_width / 2
    ct_norm = np.clip(ct_slice, low, high)
    ct_norm = ((ct_norm - low) / (high - low) * 255).astype(np.uint8)

    # Create RGBA overlay
    h, w = seg_slice.shape
    overlay = np.zeros((h, w, 4), dtype=np.uint8)

    for label_val, (r, g, b) in LABEL_COLORS.items():
        mask = seg_slice == label_val
        if not np.any(mask):
            continue
        a = int(alpha * 255)
        # If this label should be highlighted, use full opacity
        if highlight_labels and label_val in highlight_labels:
            a = int(0.7 * 255)
        overlay[mask] = [r, g, b, a]

    # Render
    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    ax.imshow(ct_norm, cmap="gray", origin="upper")
    ax.imshow(overlay, origin="upper")
    ax.axis("off")

    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0, facecolor="black")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def _render_zoomed_slice(ct_data, seg_data, slice_idx, label_ids, axis=2,
                          window_center=40, window_width=400, padding=25,
                          figsize=(4, 4), dpi=120):
    """
    Render a zoomed-in view of the region containing the specified labels.
    Returns PNG bytes or None if no labels found.
    """
    ct_slice = np.take(ct_data, slice_idx, axis=axis)
    seg_slice = np.take(seg_data, slice_idx, axis=axis)

    ct_slice = np.rot90(ct_slice, k=1)
    ct_slice = np.flip(ct_slice, axis=0)
    seg_slice = np.rot90(seg_slice, k=1)
    seg_slice = np.flip(seg_slice, axis=0)

    # Find bounding box of the labels
    mask = np.isin(seg_slice, label_ids)
    if not np.any(mask):
        return None

    coords = np.array(np.where(mask))
    r0, r1 = int(coords[0].min()), int(coords[0].max())
    c0, c1 = int(coords[1].min()), int(coords[1].max())

    # Add padding
    h, w = seg_slice.shape
    r0 = max(r0 - padding, 0)
    r1 = min(r1 + padding, h)
    c0 = max(c0 - padding, 0)
    c1 = min(c1 + padding, w)

    # Crop
    ct_crop = ct_slice[r0:r1, c0:c1]
    seg_crop = seg_slice[r0:r1, c0:c1]

    # Apply windowing
    low = window_center - window_width / 2
    high = window_center + window_width / 2
    ct_norm = np.clip(ct_crop, low, high)
    ct_norm = ((ct_norm - low) / (high - low) * 255).astype(np.uint8)

    # Create overlay (higher alpha for zoom)
    ch, cw = seg_crop.shape
    overlay = np.zeros((ch, cw, 4), dtype=np.uint8)
    for label_val, (r, g, b) in LABEL_COLORS.items():
        lm = seg_crop == label_val
        if np.any(lm):
            overlay[lm] = [r, g, b, int(0.55 * 255)]

    # Also draw contour around the target labels
    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    ax.imshow(ct_norm, cmap="gray", origin="upper")
    ax.imshow(overlay, origin="upper")

    # Draw contours for target labels
    target_mask = np.isin(seg_crop, label_ids).astype(float)
    if np.any(target_mask):
        ax.contour(target_mask, colors=["#ff3355"], linewidths=1.5)

    ax.axis("off")
    buf = BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", pad_inches=0, facecolor="black")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def generate_ai_analysis_images(case_id: str):
    """
    Generate all images needed for the AI Analysis walkthrough.

    Returns a dict:
    {
      "case_id": str,
      "organs": {
        "pancreas": {
          "localize": { "base64": str, "slice_index": int, "axis": str },
          "detect":   { "base64": str, "slice_index": int } | null,
          "voxel_count": int
        },
        ...
      }
    }
    """
    result = _load_case_volumes(case_id)
    if result is None:
        return {"case_id": case_id, "organs": {}, "error": "Could not load NIfTI volumes"}

    ct_data, seg_data, affine = result
    organs_output = {}

    for organ_name, config in ORGAN_GROUPS.items():
        labels = config["labels"]
        lesion_labels = config["lesion_labels"]

        # Find best axial slice for this organ group
        best_slice, voxel_count = _find_best_slice(seg_data, labels, axis=2)

        if voxel_count == 0:
            organs_output[organ_name] = {"voxel_count": 0}
            continue

        # Generate localization image (full slice with overlay)
        loc_bytes = _render_slice_with_overlay(
            ct_data, seg_data, best_slice, axis=2,
            highlight_labels=labels
        )

        # Generate detection/zoom image
        det_bytes = _render_zoomed_slice(
            ct_data, seg_data, best_slice, labels, axis=2
        )

        # If there are lesion labels, also find the best lesion slice
        lesion_data = None
        if lesion_labels:
            les_slice, les_count = _find_best_slice(seg_data, lesion_labels, axis=2)
            if les_count > 0:
                les_zoom = _render_zoomed_slice(
                    ct_data, seg_data, les_slice, lesion_labels, axis=2, padding=15
                )
                if les_zoom:
                    lesion_data = {
                        "base64": base64.b64encode(les_zoom).decode("ascii"),
                        "slice_index": les_slice,
                        "voxel_count": les_count,
                    }

        organs_output[organ_name] = {
            "voxel_count": voxel_count,
            "localize": {
                "base64": base64.b64encode(loc_bytes).decode("ascii"),
                "slice_index": best_slice,
                "axis": "axial",
            },
            "detect": {
                "base64": base64.b64encode(det_bytes).decode("ascii"),
                "slice_index": best_slice,
            } if det_bytes else None,
            "lesion": lesion_data,
        }

    return {"case_id": case_id, "organs": organs_output}