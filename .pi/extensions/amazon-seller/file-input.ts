import { basename, resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";

const MAX_REPORT_BYTES = 25 * 1024 * 1024;

export interface AmazonReportFile {
	content: string;
	fileName: string;
	resolvedPath: string;
	sizeBytes: number;
}

export async function readAmazonReportFile(filePath: string, signal?: AbortSignal): Promise<AmazonReportFile> {
	const resolvedPath = resolve(filePath);
	const metadata = await stat(resolvedPath);
	if (!metadata.isFile()) throw new Error("Amazon report path must point to a regular file");
	if (metadata.size > MAX_REPORT_BYTES) {
		throw new Error("Amazon report exceeds the 25 MiB read-only file limit");
	}

	const content = await readFile(resolvedPath, { encoding: "utf8", signal });
	return {
		content,
		fileName: basename(resolvedPath),
		resolvedPath,
		sizeBytes: metadata.size,
	};
}
