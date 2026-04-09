import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPanTSId } from "../helpers/utils";
import type { PreviewType } from "../types";

type Props = {
	id: number;
	previewMetadata: PreviewType;
};
export default function Preview({ id, previewMetadata }: Props) {
	const navigate = useNavigate();
	
	// ! if image not preloaded in public folder

	const [thumbnail, setThumbnail] = useState<string>("");
	useEffect(() => {
		const getPreview = async () => {
			try {
			const res = await fetch(`https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main/profile_only/${getPanTSId(id.toString())}/profile.jpg?download=true`);
				if (!res.ok) {
					throw new Error(
						`Failed to fetch preview: ${res.status} ${res.statusText}`
					);
				}
				const data = await res.blob();
				const url = URL.createObjectURL(data);
				setThumbnail(url);
			} catch (e) {
				console.error(e);
			}
		};
		getPreview();
	}, [id]);

	if (!previewMetadata) return null;

	return (
		<div className="flex flex-col gap-2 p-4 shadow-md bg-blue-950">
			<div className="flex flex-col justify-center items-center gap-1">
				<div className="w-[400px] h-[300px] relative">

				{/* <img src={`/case_1_slice.png`} alt="Preview" className="w-full h-full object-cover absolute top-0 left-0 opacity-95"/> */}
				<img src={thumbnail} alt="Preview" className="w-full h-full object-cover absolute top-0"/>
				</div>
				{/* <div className="flex justify-between w-full"> */}
				<p className="font-bold text-lg">Case {id}</p>
				<div className="flex gap-2">

				<div>Age: {previewMetadata.age || "-"}</div>
				<div>Sex: {previewMetadata.sex || "-"}</div>
				{/* </div> */}
				</div>
			</div>
			<button onClick={() => navigate(`/case/${id}`)} className="w-full">View Case</button>
		</div>
	);
}
