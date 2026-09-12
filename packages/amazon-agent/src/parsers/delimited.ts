import type { ReportDelimiter } from "../types/advertising.ts";

export class DelimitedTextError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DelimitedTextError";
	}
}

export function parseDelimitedText(input: string, delimiter: ReportDelimiter): string[][] {
	if (input.length === 0) return [];

	const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let inQuotes = false;

	const pushRow = () => {
		row.push(field);
		rows.push(row);
		row = [];
		field = "";
	};

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];

		if (inQuotes) {
			if (char === '"') {
				if (source[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					inQuotes = false;
				}
			} else if (char === "\r" && source[index + 1] === "\n") {
				field += "\n";
				index += 1;
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"' && field.length === 0) {
			inQuotes = true;
			continue;
		}

		if (char === delimiter) {
			row.push(field);
			field = "";
			continue;
		}

		if (char === "\n" || char === "\r") {
			pushRow();
			if (char === "\r" && source[index + 1] === "\n") index += 1;
			continue;
		}

		field += char;
	}

	if (inQuotes) throw new DelimitedTextError("Unterminated quoted field");
	if (field.length > 0 || row.length > 0) pushRow();

	if (rows.length > 1) {
		const width = rows[0].length;
		for (let index = 1; index < rows.length; index += 1) {
			if (rows[index].length !== width) {
				throw new DelimitedTextError(
					`Row ${index + 1} has ${rows[index].length} fields; expected ${width}`,
				);
			}
		}
	}

	return rows;
}
