type Props = {
    aboutRef: React.RefObject<HTMLDivElement | null>;
}

export default function About({aboutRef}: Props) {
    return (
        <section
        ref={aboutRef}
        className="flex flex-col gap-4 justify-center items-center w-screen pb-2"
        >
				<div className="flex flex-col gap-1.5 w-6/12 items-center">
					<div className="text-2xl font-bold">About PanTS</div>
					<p>
						The Pancreatic Tumor Segmentation Dataset (PanTS) is a
						multi-institutional dataset created by JHU containing{" "}
						<span className="font-bold">36,390</span> three-dimensional CT
						volumes in <span className="font-bold">145</span> medical centers,
						with expert wise voxel annotations of over{" "}
						<span className="font-bold">993,000</span> anatomical structures.
						This website aims to allow users to visualize and explore the
						dataset.
					</p>
					<br />
					<div>
						If you would like to know more about PanTS, refer to the{" "}
						<span
							className="font-bold cursor-pointer underline"
							onClick={() =>
								(window.location.href =
									"https://www.cs.jhu.edu/~zongwei/publication/li2025pants.pdf")
                                }
                                >
							paper
						</span>
					</div>
				</div>
			</section>
)
}