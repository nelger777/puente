/**
 * CSV that opens straight in a Spanish-locale Excel: ";" separator and a UTF-8 BOM so accents
 * survive. Fields with separators, quotes or line breaks are quoted.
 */
export function toCsv(rows: (string | number)[][]): string {
  const field = (value: string | number) => {
    const text = String(value);
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "﻿" + rows.map((row) => row.map(field).join(";")).join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
