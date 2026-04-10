import { BrowserRouter, Route, Routes } from "react-router";
import "./App.css";
import { default as RotatingHeartLoader } from "./components/Loading";
import { AnnotationProvider } from "./contexts/annotationContexts";
import { FileProvider } from "./contexts/fileContexts";
import Homepage from "./routes/Homepage";
import UploadPage from "./routes/UploadPage";
import VisualizationPage from "./routes/VisualizationPage";
import InteractiveReportPage from "./routes/InteractiveReportPage";
import AIAnalysisPage from "./routes/AIAnalysisPage";

const BASENAME = import.meta.env.VITE_BASENAME || '/PanTS-Viewer';

function App() {
	return (
		<>
			<FileProvider>
				<AnnotationProvider>
				<div className="App">
					<BrowserRouter basename={BASENAME}>
						<Routes>
							<Route path="/" element={<Homepage />} />
							{/* <Route path="/data" element={<DataPage />} /> */}
							{/* <Route path="/:type/:page" element={<Homepage />} /> */}
							<Route path="/case/:caseId" element={<VisualizationPage />} />
							<Route path="/report/:caseId" element={<InteractiveReportPage />} />
							<Route path="/ai-analysis/:caseId" element={<AIAnalysisPage />} />
							<Route path="/test" element={<RotatingHeartLoader />} />
							<Route path="/upload" element={<UploadPage />} />
						</Routes>
					</BrowserRouter>
				</div>
				</AnnotationProvider>
			</FileProvider>
		</>
	);
}	

export default App;
