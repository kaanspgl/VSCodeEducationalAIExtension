import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

/**
 * The consent form a participant reads before signing in. The built-in text sums up the study from its
 * proposal; the researcher page can replace it with the wording the ethics board approved (data/consent.md).
 * Every consent is logged with the version of the text that was on screen.
 */
const FILE = path.join(DATA_DIR, "consent.md");

export const DEFAULT_CONSENT = `**Structured Vibe Coding with VibeLearner: An AI-Supported Programming Environment for Learning-Oriented Code Assistance**

Principal investigator: Dr. Abdallah Mohamed, Department of Computer Science, UBC Okanagan
Student researcher: Necmi Kaan Sapoglu, Department of Computer Science, UBC Okanagan (COSC 449 Honours Thesis)

This page sums up the information letter you were given. Read the letter first, and ask the researcher about anything that isn't clear before you continue.

## What you will do
- One supervised session of about 45 minutes.
- Build small Python programs with VibeLearner, an AI coding assistant, in two parts: Loops, then Lists. There are two versions of VibeLearner, and you will use one in each part.
- Answer a short quiz before and after each part, and a short questionnaire at the end.
- Nothing here is graded.

## What is recorded
- What you do in VibeLearner during this session: your requests, the AI's replies, code changes, your answers, program output and timings.
- Your quiz and questionnaire answers.
- Everything is stored under your participant code, not your name. No list linking codes to names is kept.

## Your privacy
- The AI model runs on a UBC-managed computer. Nothing you type is sent to outside AI companies.
- Please don't type personal information (your name, student number or email). Use only the made-up data in the tasks.
- Only the principal investigator and the student researcher can access the study data. It is kept on encrypted UBC storage for at least five years and then deleted.

## Your choice
- Taking part is voluntary. You can stop at any time by telling the researcher.
- You can withdraw your data up to 14 days after your session.`;

/** What the participant ticks. Fixed, so every consent in the log means the same thing. */
export const CONSENT_STATEMENT =
  "I have read the information letter, I am 18 or older, and I consent to take part in this study. I understand that what I do in this session " +
  "(messages, code changes, answers, program output and timings) is recorded for research under my participant code.";

export type Consent = { text: string; statement: string; version: string; custom: boolean };

export function readConsent(): Consent {
  let text = "";
  try {
    text = fs.readFileSync(FILE, "utf8").replace(/^﻿/, "").trim();
  } catch {
    /* no file: the built-in text */
  }
  const custom = !!text;
  if (!custom) text = DEFAULT_CONSENT;
  return { text, statement: CONSENT_STATEMENT, custom, version: createHash("sha256").update(`${text}\n${CONSENT_STATEMENT}`).digest("hex").slice(0, 10) };
}

/** Saves the researcher's own wording; an empty text goes back to the built-in one. */
export function writeConsent(text: string) {
  const t = text.replace(/\r\n/g, "\n").trim().slice(0, 20000);
  if (!t || t === DEFAULT_CONSENT) return fs.rmSync(FILE, { force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, t + "\n", "utf8");
}
