import type { RenderingEngine } from "@cornerstonejs/core";
import type {
	Color,
	ColorLUT,
	IImageVolume,
} from "@cornerstonejs/core/dist/types/types";
import { Niivue } from "@niivue/niivue";
import {
	IconDownload, IconHome, IconPointer, IconReport,
	IconSettings,
	IconZoom
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import RotatingModelLoader from "../components/Loading";
import OpacitySlider from "../components/OpacitySlider/OpacitySlider";
import OrganCheckbox from "../components/OrganCheckbox";
import ReportScreen from "../components/ReportScreen/ReportScreen";
import SnakeGame from "../components/SnakeGame/SnakeGame";
import WindowingSlider from "../components/WindowingSlider/WindowingSlider";
import ZoomHandle from "../components/zoomHandle";
import {
	renderVisualization,
	setToolGroupOpacity,
	setVisibilities,
	toggleCrosshairTool,
} from "../helpers/CornerstoneNifti";
import { create3DVolume, updateVisibilities } from "../helpers/NiiVueNifti";
import {
	API_BASE,
	APP_CONSTANTS,
	segmentation_categories,
	segmentation_category_colors,
} from "../helpers/constants";
import { filenameToName } from "../helpers/utils";
import { type CheckBoxData, type LastClicked, type NColorMap } from "../types";
import "./VisualizationPage.css";

function VisualizationPage() {
	// References and state
	const params = useParams();
	const pantsCase = params.caseId ?? "1";
	const navigate = useNavigate();

	const axial_ref = useRef<HTMLDivElement>(null);
	const sagittal_ref = useRef<HTMLDivElement>(null);
	const coronal_ref = useRef<HTMLDivElement>(null);
	const render_ref = useRef<HTMLCanvasElement>(null);
	const cmapRef = useRef<NColorMap>(null);
	const VisualizationContainer_ref = useRef(null);
	const segmentationRef = useRef<IImageVolume>(null);

	const [checkState, setCheckState] = useState<boolean[]>([true]);
	const [segmentationRepresentationUIDs, setSegmentationRepresentationUIDs] =
		useState<string[] | null>(null);
	const [NV, setNV] = useState<Niivue | undefined>();
	const [sessionKey, _setSessionKey] = useState<string | undefined>(undefined);
	const [checkBoxData, setCheckBoxData] = useState<CheckBoxData[]>([]);
	const [opacityValue, setOpacityValue] = useState(
		APP_CONSTANTS.DEFAULT_SEGMENTATION_OPACITY * 100
	);
	const [windowWidth, setWindowWidth] = useState(400);
	const [windowCenter, setWindowCenter] = useState(50);
	const [renderingEngine, setRenderingEngine] =
		useState<RenderingEngine | null>(null);
	const [viewportIds, setViewportIds] = useState<string[]>([]);
	const [volumeId, setVolumeId] = useState<string | null>(null);
	const [showReportScreen, setShowReportScreen] = useState(false);
	const [_lastClicked, setLastClicked] = useState<LastClicked | null>(null);
	const [showTaskDetails, setShowTaskDetails] = useState(true);
	const [showOrganDetails, setShowOrganDetails] = useState(false);
	const [loading, setLoading] = useState(true);
	const [labelColorMap, _setLabelColorMap] = useState<{ [key: number]: Color }>(
		segmentation_category_colors
	);
	const [zoomMode, setZoomMode] = useState(false);
	const [zoomLevel, setZoomLevel] = useState(1);
	const [crosshairToolActive, setCrosshairToolActive] = useState(false);

	useEffect(() => {
		toggleCrosshairTool(crosshairToolActive);
	}, [crosshairToolActive]);

	useEffect(() => {
		const setup = async () => {
			const checkBoxData = segmentation_categories.map((filename, i) => ({
				label: filenameToName(filename),
				id: i + 1,
			}));
			setCheckBoxData(checkBoxData);

			const initialState = [true];
			checkBoxData.forEach((item) => {
				initialState[item.id] = true;
			});
			setCheckState(initialState);

			const max = Math.max(
				...Object.keys(labelColorMap).map((key) => parseInt(key))
			);
			const cmap: ColorLUT = Array.from({ length: max + 1 }, () => [
				0, 0, 0, 0,
			]);
			for (const key in labelColorMap) {
				cmap[parseInt(key)] = labelColorMap[parseInt(key)];
			}

			if (
				!axial_ref.current ||
				!sagittal_ref.current ||
				!coronal_ref.current ||
				!render_ref.current ||
				cmap.length === 0
			)
				return;

			const result = await renderVisualization(
				axial_ref.current,
				sagittal_ref.current,
				coronal_ref.current,
				cmap,
				pantsCase,
				setLoading
			);

			if (!result) return;

			const {
				segmentationVolumeArray,
				segRepUIDs,
				renderingEngine,
				viewportIds,
				volumeId,
			} = result;

			setSegmentationRepresentationUIDs(segRepUIDs);
			setRenderingEngine(renderingEngine);
			setViewportIds(viewportIds);
			setVolumeId(volumeId);

			const { nv, cmapCopy } = await create3DVolume(
				render_ref,
				pantsCase,
				labelColorMap
			);
			cmapRef.current = cmapCopy;
			setNV(nv);
			segmentationRef.current = segmentationVolumeArray;
		};
		setup();
	}, [
		pantsCase,
		axial_ref,
		sagittal_ref,
		coronal_ref,
		render_ref,
		labelColorMap,
	]);

	const handleWindowChange = (
		newWidth: number | null,
		newCenter: number | null
	) => {
		const _width = Math.max(newWidth ?? windowWidth, 1);
		const _center = newCenter ?? windowCenter;
		setWindowWidth(_width);
		setWindowCenter(_center);

		if (!renderingEngine || !viewportIds.length || !volumeId) return;

		const windowLow = _center - _width / 2;
		const windowHigh = _center + _width / 2;

		viewportIds.forEach((viewportId) => {
			const viewport = renderingEngine.getViewport(viewportId);
			const actors = viewport.getActors();
			for (const actor of actors) {
				if (actor.uid === volumeId) {
					try {
						const tf = actor.actor.getProperty().getRGBTransferFunction(0);
						tf.setMappingRange(windowLow, windowHigh);
						tf.updateRange();
						viewport.render();
					} catch (e) {
						console.warn("[VOI Error]", e);
					}
				}
			}
		});
	};

	useEffect(() => {
		if (renderingEngine && viewportIds.length && volumeId) {
			handleWindowChange(windowWidth, windowCenter);
		}
	}, [renderingEngine, viewportIds, volumeId]);

	useEffect(() => {
		if (segmentationRepresentationUIDs && checkState && NV) {
			const checkStateArr = [
				true,
				...checkBoxData.map((item) => !!checkState[item.id]),
			];
			console.log("150", checkStateArr);
			setVisibilities(segmentationRepresentationUIDs, checkStateArr);
			updateVisibilities(NV, checkStateArr, sessionKey, cmapRef.current);
		}
	}, [
		segmentationRepresentationUIDs,
		checkState,
		NV,
		checkBoxData,
		sessionKey,
	]);

	const handleOpacityOnSliderChange = (
		event: React.ChangeEvent<HTMLInputElement>
	) => {
		const value = Number(event.target.value);
		setOpacityValue(value);
		setToolGroupOpacity(value / 100);
	};

	const handleOpacityOnFormSubmit = (value: number) => {
		setOpacityValue(value);
		setToolGroupOpacity(value / 100);
	};

	const handleDownloadClick = async () => {
		const response = await fetch(`${API_BASE}/api/download/${pantsCase}`);
		const blob = await response.blob();
		const url = window.URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${pantsCase}_segmentations.zip`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		window.URL.revokeObjectURL(url);
	};

	const navBack = () => {
		window.location.href = "/home.html";
	};

	return (
		<div
			className="VisualizationPage"
			style={{
				display: "flex",
				overflow: "hidden",
				flexDirection: "column",
				height: "100vh",
				width: "100vw",
			}}
		>
			<div style={{ position: "relative" }}>
				<div className="sidebar position-absolute z-3 top-0 left-0">
					<div>
						<div className="flex">
							<div
								className={`hover:bg-gray-700 z-4 cursor-pointer bg-[#0f0824] p-2 ml-4 mt-4 rounded-lg w-fit`}
								onClick={() => setShowTaskDetails((prev) => !prev)}
							>
								<IconSettings color="white" />
							</div>
							<div
								className={`hover:bg-gray-700 z-4 cursor-pointer bg-[#0f0824] p-2 ml-4 mt-4 rounded-lg w-fit`}
								onClick={() => navBack()}
							>
								<IconHome color="white" />
							</div>
						</div>
						<div
							className={`text-black bg-[#0f0824] m-4 z-3 rounded-lg w-64 p-4 pt-3 gap-3 flex flex-col relative transition-all duration-100 origin-top-left ${
								showTaskDetails ? "scale-0" : "scale-100"
							}`}
						>
							{!showTaskDetails && (
								<>
									{!zoomMode && (
										<div className="grid grid-cols-6 items-center justify-center">
											<div></div>
											<div className="text-white font-bold text-xl col-span-4">{`Case ID: ${pantsCase}`}</div>
											<div></div>
										</div>
									)}

									{zoomMode ? (
										<ZoomHandle
											submitted={zoomLevel}
											setSubmitted={setZoomLevel}
											setZoomMode={setZoomMode}
										/>
									) : (
										<>
											<OpacitySlider
												opacityValue={opacityValue}
												handleOpacityOnSliderChange={handleOpacityOnSliderChange}
												handleOpacityOnFormSubmit={handleOpacityOnFormSubmit}
											/>
											<WindowingSlider
												windowWidth={windowWidth}
												windowCenter={windowCenter}
												onWindowChange={handleWindowChange}
											/>
										</>
									)}

									{!zoomMode ? (
										<>
											<button
												className="text-white relative pt-3 !bg-blue-900 hover:!border-white"
												onClick={() => {
													setShowOrganDetails((prev) => !prev);
													setShowTaskDetails((prev) => !prev);
												}}
											>
												Class Map
											</button>
											<div className="flex gap-3 items-center justify-center">
												{/* Crosshair */}
												<div className="group cursor-pointer rounded-md relative border">
													<div
														className={`border-gray-500 hover:bg-gray-700 border rounded-md p-2 ${
															crosshairToolActive ? "bg-gray-700" : ""
														}`}
													>
														<IconPointer
															className="w-6 h-6 text-white relative cursor-pointer"
															onClick={() => setCrosshairToolActive((prev) => !prev)}
														/>
													</div>
													<span className="transition-all pointer-events-none duration-100 scale-0 group-hover:scale-100 absolute top-0 left-12 z-1 bg-gray-900 text-white rounded-md p-2">
														Crosshair Mode
													</span>
												</div>

												{/* Zoom */}
												<div className="group cursor-pointer rounded-md relative">
													<div className="border-gray-500 hover:bg-gray-700 border rounded-md p-2">
														<IconZoom
															onClick={() => setZoomMode(true)}
															className="w-6 h-6 text-white relative"
														/>
													</div>
													<span className="transition-all pointer-events-none duration-100 scale-0 group-hover:scale-100 absolute top-0 left-12 z-1 bg-gray-900 text-white rounded-md p-2">
														Zoom
													</span>
												</div>

												{/* Download */}
												<div className="group cursor-pointer rounded-md relative">
													<div className="border-gray-500 hover:bg-gray-700 border rounded-md p-2">
														<IconDownload
															onClick={handleDownloadClick}
															className="w-6 h-6 text-white relative"
														/>
													</div>
													<span className="transition-all pointer-events-none duration-100 scale-0 group-hover:scale-100 absolute top-0 left-12 z-1 bg-gray-900 text-white rounded-md p-2">
														Download
													</span>
												</div>

												{/* Report */}
												<div className="group cursor-pointer rounded-md relative" onClick={() => navigate(`/report/${pantsCase}`)}>
													<div className="border-gray-500 hover:bg-gray-700 border rounded-md p-2">
														<IconReport className="w-6 h-6 text-white relative" />
													</div>
													<span className="transition-all pointer-events-none duration-100 scale-0 group-hover:scale-100 absolute top-0 left-12 z-1 bg-gray-900 text-white rounded-md p-2">
														Report
													</span>
												</div>

												{/* AI Analysis */}
												<div className="group cursor-pointer rounded-md relative" onClick={() => navigate(`/ai-analysis/${pantsCase}`)}>
													<div className="border-gray-500 hover:bg-gray-700 border rounded-md p-2">
														<span className="w-6 h-6 text-white relative text-lg">⧫</span>
													</div>
													<span className="transition-all pointer-events-none duration-100 scale-0 group-hover:scale-100 absolute top-0 left-12 z-1 bg-gray-900 text-white rounded-md p-2">
														AI Analysis
													</span>
												</div>
											</div>
										</>
									) : null}
								</>
							)}
						</div>
					</div>
				</div>

				{loading ? (
					<div className="flex flex-col gap-40 items-center justify-center">
						<div className="w-fit z-99">
							<SnakeGame />
						</div>
						<RotatingModelLoader />
					</div>
				) : null}

				<div
					className="visualization-container"
					ref={VisualizationContainer_ref}
					style={{ overflow: "hidden" }}
				>
					<div
						className={`axial ${loading ? "" : "border-b-8 border-r-8 border-gray-800"}`}
						ref={axial_ref}
						onMouseDown={(e) =>
							setLastClicked({
								orientation: "axial",
								x: Math.floor(e.clientX - e.currentTarget.getBoundingClientRect().left),
								y: Math.floor(e.clientY - e.currentTarget.getBoundingClientRect().top),
							})
						}
					></div>
					<div
						className={`sagittal ${loading ? "" : "border-b-8 border-l-8 border-gray-800"}`}
						ref={sagittal_ref}
						onMouseDown={(e) =>
							setLastClicked({
								orientation: "sagittal",
								x: Math.floor(e.clientX - e.currentTarget.getBoundingClientRect().left),
								y: Math.floor(e.clientY - e.currentTarget.getBoundingClientRect().top),
							})
						}
					></div>
					<div
						className={`coronal ${loading ? "" : "border-t-8 border-r-8 border-gray-800"}`}
						ref={coronal_ref}
						onMouseDown={(e) =>
							setLastClicked({
								orientation: "coronal",
								x: Math.floor(e.clientX - e.currentTarget.getBoundingClientRect().left),
								y: Math.floor(e.clientY - e.currentTarget.getBoundingClientRect().top),
							})
						}
					></div>
					<div className={`render ${loading ? "" : "border-t-8 border-l-8 border-gray-800"}`}>
						<div className="canvas">
							<canvas ref={render_ref}></canvas>
						</div>
					</div>
				</div>
			</div>

			<OrganCheckbox
				setCheckState={setCheckState}
				checkState={checkState}
				sessionId={sessionKey}
				setShowTaskDetails={setShowTaskDetails}
				setShowOrganDetails={setShowOrganDetails}
				showOrganDetails={showOrganDetails}
				labelColorMap={labelColorMap}
			/>

			{showReportScreen && (
				<ReportScreen
					id={pantsCase}
					onClose={() => setShowReportScreen(false)}
				/>
			)}
		</div>
	);
}

export default VisualizationPage;