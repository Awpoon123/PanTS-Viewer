import { IconArrowLeft } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { centerOnCursor, setZoom, zoomToFit } from "../helpers/CornerstoneNifti";
type Props = {
	submitted: number;
	setSubmitted: React.Dispatch<React.SetStateAction<number>>;
	setZoomMode: React.Dispatch<React.SetStateAction<boolean>>;
};
const ZoomHandle = ({ submitted, setSubmitted, setZoomMode }: Props) => {
	const [text, setText] = useState(submitted.toString());
	// const [submitted, setSubmitted] = useState(1);
	useEffect(() => {
		setZoom(submitted);
		setText(submitted.toFixed(2));
	}, [submitted]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			const num = Math.min(Math.max(Number(text), 0.5), 2);

			if (!isNaN(num)) {
				setSubmitted(num);
				setText(num.toFixed(2)); // clear input if you want
			} else {
				setText(submitted.toFixed(2));
			}
		}
	};
	return (
		<div className="flex flex-col gap-2 items-center">
			<div className="flex flex-start w-full">
				<IconArrowLeft className="cursor-pointer text-white" onClick={() => setZoomMode(false)}>

				</IconArrowLeft>
			</div>
			<div className="flex flex-col items-center gap-3">

			<div className="flex gap-2 items-center justify-between w-full">
				<div className="text-white">Zoom</div>

				<div className="flex gap-1 w-2/3 justify-end">
				<input
					type="text"
					value={text}	
					onChange={(e) => setText(e.target.value.replace(/[^0-9.-]/g, ""))} // allow only digits, minus, dot
					onKeyDown={handleKeyDown}
					className="border text-white p-1 rounded-md w-1/3"
					/>
				<div  className="flex gap-0.5 text-white">
					<button className="text-white !bg-blue-950 w-8 h-8 !p-1" onClick={() => setSubmitted(Math.max(submitted - 0.1, 0.5))}>
						-
					</button>
					<button className="text-white !bg-blue-950 w-8 h-8 !p-1" onClick={() => setSubmitted(Math.min(submitted + 0.1, 3))}>
						+
					</button>
				</div>
				</div>
			</div>
			<div className="flex flex-col gap-2 w-full">

			<button className="text-white !font-medium text-xl !p-1.5" onClick={() => {
				centerOnCursor();
			}}>
				Center on cursor
			</button>
			<button className="text-white !font-medium text-xl !p-1.5" onClick={() => {
				zoomToFit();
				setText("1.0");
			}}>
				Zoom to fit
			</button>

			</div>
			</div>
			{/* <div className="flex gap-2 text-white">
				{[0.75, 1, 1.5].map((el, idx) => (
					<button key={idx} onClick={() => setSubmitted(el)} className="!bg-blue-950 h-10 !text-sm">
					{el}x
					</button>
					))}
					</div> */}
		</div>
	);
};

export default ZoomHandle;
