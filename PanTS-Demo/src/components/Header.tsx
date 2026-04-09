import { useNavigate } from "react-router-dom";

type Props = {
    handleAboutClick: () => void
}
export default function Header({handleAboutClick}: Props)  {
    const navigate = useNavigate();
    return(
        <header className="flex items-center pl-8 justify-start gap-20 w-screen p-4 bg-black relative">
				<div className="text-4xl cursor-pointer" onClick={() => navigate("/")}>PanTS Data</div>
				<div className="flex items-center gap-8 justify-center">
					{/* <div className="text-lg cursor-pointer group relative">
						Browse Full Catalog
						<div className="scale-0 flex flex-col rounded gap-2 p-2 w-full transition-all bg-gray-800 absolute top-8 origin-top group-hover:scale-100 duration-100">
							<div
								className="cursor-pointer hover:bg-gray-700 rounded p-0.5 text-base"
								// onClick={() => navigate("/data")}
							>
								Train
							</div>
							<div
								className="cursor-pointer hover:bg-gray-700 rounded p-0.5 text-base"
								onClick={() =>
									navigate(`/`)
								}
							>
								Test
							</div>
						</div>
					</div> */}
					<div
						className="text-lg cursor-pointer"
						onClick={() =>
							(window.location.href = "https://github.com/MrGiovanni/PanTS")
						}
					>
						Github
					</div>
					<div
						className="text-lg cursor-pointer"
						onClick={() => handleAboutClick()}
					>
						About
					</div>
				</div>
			</header>
)
}