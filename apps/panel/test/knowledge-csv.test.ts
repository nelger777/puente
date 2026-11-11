import { describe, expect, it } from "vitest";
import { toCsv } from "../src/lib/csv";
import { knowledgeCsvRows, parseCsv, parseKnowledgeCsv } from "../src/lib/knowledge-csv";

describe("parseCsv", () => {
  it("detects the separator and handles quotes, BOM and line breaks", () => {
    expect(parseCsv('﻿a;b\r\n"x;1";"di ""hola""\nchau"\r\n')).toEqual([
      ["a", "b"],
      ["x;1", 'di "hola"\nchau'],
    ]);
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseKnowledgeCsv", () => {
  it("reads any column order, with or without accents, and skips empty rows", () => {
    const { items, errors } = parseKnowledgeCsv(
      "Respuesta;Pregunta;categoria\nSí.;¿Cubren granizo?;Autos\n;;\n8 a 18.;¿Horario?;\n",
    );
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { question: "¿Cubren granizo?", answer: "Sí.", category: "Autos" },
      { question: "¿Horario?", answer: "8 a 18.", category: null },
    ]);
  });

  it("works without a category column", () => {
    expect(parseKnowledgeCsv("Pregunta,Respuesta\n¿Dónde?,Centro").items).toEqual([
      { question: "¿Dónde?", answer: "Centro", category: null },
    ]);
  });

  it("reports bad rows by their spreadsheet number and keeps the good ones", () => {
    const { items, errors } = parseKnowledgeCsv("Pregunta;Respuesta\n¿Uno?;1\n¿Dos?;\n");
    expect(items).toHaveLength(1);
    expect(errors).toEqual(["Fila 3: revisa la respuesta (vacía o demasiado larga)."]);
  });

  it("asks for the right header", () => {
    expect(parseKnowledgeCsv("a;b\n1;2").errors[0]).toMatch(/Pregunta y Respuesta/);
  });

  it("reads back what the export writes", () => {
    const items = [
      { question: '¿"Todo" riesgo?', answer: "Sí; con franquicia.\nConsultá.", category: "Autos" },
      { question: "¿Horario?", answer: "8 a 18.", category: null },
    ];
    expect(parseKnowledgeCsv(toCsv(knowledgeCsvRows(items))).items).toEqual(items);
  });
});
