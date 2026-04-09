import nibabel as nib
import numpy as np
from constants import Constants
from werkzeug.datastructures import MultiDict
import scipy.ndimage as ndimage
import os
import tempfile
from scipy.ndimage import label


def has_large_connected_component(slice_mask, threshold=8):
    """
    Check if there is a connected component larger than a threshold in a 2D mask.
    """
    labeled, num_features = label(slice_mask)
    sizes = np.bincount(labeled.ravel())
    sizes[0] = 0  # ignore background
    return np.any(sizes > threshold)


class NiftiProcessor:
    def __init__(self, main_nifti_path, clabel_path, organ_intensities=None):
        self._main_nifti_path = main_nifti_path
        self._clabel_path = clabel_path
        self.number_max = 999999
        self._organ_intensities = organ_intensities
    
    def set_organ_intensities(self, organ_intensities):
        self._organ_intensities = organ_intensities

    @classmethod
    def from_clabel_path(cls, clabel_path):
        return cls(None, clabel_path)
    
    def calculate_metrics(self):    
        """
        Calculate volume and mean HU for each organ based on the segmentation.
        """
        if self._organ_intensities is None or self._clabel_path is None or self._main_nifti_path is None:
            raise Exception("Cannot calculate metrics if self._organ_intensities, self._clabel_path, or self._main_nifti_path is None.")  

        data = {"organ_metrics": []}

        clabel_obj = nib.load(self._clabel_path)
        main_nifti_obj = nib.load(self._main_nifti_path)

        clabel_array = np.around(clabel_obj.get_fdata())
        clabel_header = clabel_obj.header
        main_nifti_array = main_nifti_obj.get_fdata()

        intensities, frequencies = np.unique(clabel_array, return_counts=True)
        int_freq = {round(intensities[i]): int(frequencies[i]) for i in range(len(intensities))}

        voxel_dims_mm = clabel_header.get_zooms()
        voxel_volume_cm3 = np.prod(voxel_dims_mm) / 1000  # convert mm³ to cm³
        for organ, label_val in self._organ_intensities.items():
            binary_mask = (clabel_array == label_val)
            slice_0 = binary_mask[:, :, 0]
            slice_last = binary_mask[:, :, -1]

            
            if has_large_connected_component(slice_0, 8) or has_large_connected_component(slice_last, 8):
                data["organ_metrics"].append({
                    "organ_name": organ,
                    "volume_cm3": self.number_max,
                    "mean_hu": self.number_max
                })
                continue
            if label_val in int_freq:
                volume_cm3 = round(float(int_freq[label_val] * voxel_volume_cm3), Constants.DECIMAL_PRECISION_VOLUME)
            else:
                volume_cm3 = 0
            mean_hu = self.calculate_mean_hu_with_erosion(binary_mask, main_nifti_array)

            data["organ_metrics"].append({
                "organ_name": organ,
                "volume_cm3": volume_cm3,
                "mean_hu": mean_hu
            })

        return data

    def calculate_mean_hu_with_erosion(self, binary_mask, ct_array):
        """
        Calculate mean HU using erosion to avoid edge noise.
        """
        erosion_array = ndimage.binary_erosion(binary_mask, structure=Constants.STRUCTURING_ELEMENT)
        hu_values = ct_array[erosion_array > 0]

        if hu_values.size == 0:
            hu_values = ct_array[binary_mask > 0]

        if hu_values.size == 0:
            return 0

        return round(float(np.mean(hu_values)), Constants.DECIMAL_PRECISION_HU)

    def combine_labels(self, filenames: list[str], nifti_multi_dict: MultiDict, save=True):
        """
        Merge multiple label masks into one combined segmentation and re-index the labels.
        """
        organ_intensities = {}

        if len(filenames) == 1:
            filename = filenames[0]
            segmentation = nifti_multi_dict[filename]
            data = segmentation.read()

            with tempfile.NamedTemporaryFile(suffix='.nii.gz', delete=False) as temp:
                temp.write(data)
                temp.flush()
                temp_path = temp.name

            combined_labels = nib.load(temp_path)
            
            combined_labels_img_data = combined_labels.get_fdata().astype(np.uint8)

            unique_labels = sorted([v for v in np.unique(combined_labels_img_data) if v != 0])
            original_to_new = {}

            for new_label, original_label in enumerate(unique_labels, start=1):
                original_to_new[int(original_label)] = new_label
                combined_labels_img_data[combined_labels_img_data == original_label] = new_label

            for original_label, new_label in original_to_new.items():
                organ_name = Constants.PREDEFINED_LABELS.get(original_label, f"label_{original_label}")
                organ_intensities[organ_name] = new_label

            combined_labels_header = combined_labels.header
            combined_labels_affine = combined_labels.affine

            combined_labels = nib.Nifti1Image(
                combined_labels_img_data,
                affine=combined_labels_affine,
                header=combined_labels_header
            )
            

        else:
            combined_labels_img_data = None
            combined_labels_header = None
            combined_labels_affine = None

            for i in range(len(filenames)):
                filename = filenames[i]
                segmentation = nifti_multi_dict[filename]
                data = segmentation.read()

                with tempfile.NamedTemporaryFile(suffix='.nii.gz', delete=True) as temp:
                    temp.write(data)
                    nifti_obj = nib.load(temp.name)

                    if combined_labels_header is None:
                        combined_labels_header = nifti_obj.header

                    if combined_labels_img_data is None:
                        combined_labels_img_data = np.ndarray(shape=nifti_obj.shape, dtype=np.float64)

                    if combined_labels_affine is None:
                        combined_labels_affine = nifti_obj.affine 

                    img_data = nifti_obj.get_fdata()
                    scaled = img_data * np.float64(i + 1)
                    combined_labels_img_data = np.maximum(combined_labels_img_data, scaled)

                    organ_intensities[filename] = i + 1

            combined_labels = nib.nifti1.Nifti1Image(
                dataobj=combined_labels_img_data,
                affine=combined_labels_affine,
                header=combined_labels_header
            )

        if save:
            nib.save(combined_labels, self._clabel_path)

        return combined_labels, organ_intensities

    def __str__(self):
        return f"NiftiProcessor Object\n main_nifti_path: {self._main_nifti_path}\n clabel_path: {self._clabel_path}"

    def calculate_pdac_sma_staging(self):
        """
        Determine staging of pancreatic cancer based on SMA contact ratio.
        """
        if self._clabel_path is None:
            raise Exception("clabel path is not set.")

        clabel_obj = nib.load(self._clabel_path)
        clabel_data = np.around(clabel_obj.get_fdata()).astype(np.uint8)

        PDAC_LABEL = 20  # pancreatic_pdac
        SMA_LABEL = 26   # superior_mesenteric_artery

        pdac_mask = (clabel_data == PDAC_LABEL)
        sma_mask = (clabel_data == SMA_LABEL)

        if np.sum(pdac_mask) == 0:
            return "Stage T1 (No PDAC tumor present)"
        if np.sum(sma_mask) == 0:
            return "Unknown (SMA not found)"

        pdac_dilated = ndimage.binary_dilation(pdac_mask, structure=Constants.STRUCTURING_ELEMENT)
        contact_voxels = pdac_dilated & sma_mask
        contact_ratio = np.sum(contact_voxels) / np.sum(sma_mask)

        if contact_ratio > 0.7:
            return "Stage T4 (SMA encasement > 180°)"
        elif contact_ratio > 0.3:
            return "Stage T3 (SMA encasement ~90°–180°)"
        elif contact_ratio > 0:
            return "Stage T2 (SMA contact < 90°)"
        else:
            return "Stage T1 (No SMA contact)"