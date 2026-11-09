/**
 * The consent form participants read before signing in, word for word from ethics-documents/2. Consent Form.docx.
 * Keep the two the same: when the REB-approved form changes, update this text and CONSENT_VERSION together.
 * The version is stored with each participant's consent.
 */
export const CONSENT_VERSION = "Version 2, November 2026";

/** A paragraph, or a list (string[]). */
export type ConsentBlock = string | string[];
export type ConsentSection = { heading?: string; blocks: ConsentBlock[] };

export const CONSENT_TITLE = "Consent Form";

export const CONSENT: ConsentSection[] = [
  {
    blocks: [
      "Study title: Structured Vibe Coding with VibeLearner: An AI-Supported Programming Environment for Learning-Oriented Code Assistance",
      "UBC Behavioural Research Ethics Board study number: H25-02775",
      "Principal investigator: Dr. Abdallah Mohamed, Associate Professor of Teaching, Department of Computer Science, UBC Okanagan. abdallah.mohamed@ubc.ca",
      "Co-investigator: Necmi Kaan Sapoglu, Undergraduate Student, Department of Computer Science, UBC Okanagan. ka199967@student.ubc.ca. This study is part of Kaan's honours thesis (COSC 449). The results will be reported in the thesis and may be presented at conferences or published.",
      "Funding: This study is not funded.",
    ],
  },
  {
    heading: "Why are we doing this study?",
    blocks: [
      "Many students now use AI tools that write code for them, an approach often called \"vibe coding.\" This can produce working programs without the student understanding them. VibeLearner is an AI coding assistant that still writes the code but structures the work so students explain, read, predict and change it. We want to find out whether this structure helps students understand the code they get, and how much extra time it takes.",
    ],
  },
  {
    heading: "Why are you being invited?",
    blocks: [
      "You are invited because you are an undergraduate student at UBC Okanagan, at least 18 years old, who has completed at least one introductory programming course. You cannot take part if you helped design or test VibeLearner, or if you have already taken part in this study.",
    ],
  },
  {
    heading: "Your participation is voluntary",
    blocks: [
      "You do not have to take part. If you take part, you can skip any question and stop at any time without giving a reason. Your decision will not affect your grades or your standing in any course. Dr. Mohamed teaches in the Department of Computer Science, but will see only coded data and will not know who took part.",
    ],
  },
  {
    heading: "What happens if you take part?",
    blocks: [
      "You will attend one session of about 75–90 minutes in [CONFIRM: a computer lab at UBC Okanagan]. During the session you will:",
      [
        "Give consent on this page (about 5 minutes).",
        "Receive a participant code. The code is not linked to your name.",
        "Complete a short quiz on basic Python, without AI help (about 10 minutes). It is not graded.",
        "Use VibeLearner in a web browser to build three short Python programs (40–50 minutes).",
        "Complete a second short quiz, without AI help (about 10 minutes).",
        "Complete a survey about your experience, then read a short explanation of the study (about 10 minutes).",
      ],
      "There are two versions of VibeLearner, and you will be assigned to one of them at random. In both versions, the AI writes working code for you. One version also asks you to do some steps along the way, such as explaining your idea or predicting what a program prints. We will explain both versions, and what we expect to find, at the end of the session. We don't explain this at the start because knowing it could change how you use the tool.",
    ],
  },
  {
    heading: "What is recorded?",
    blocks: [
      [
        "Your quiz and survey answers, in UBC's survey tool (Qualtrics).",
        "Your use of VibeLearner: what you type, the AI's replies, the code you create, accept or reject, your answers to VibeLearner's questions, the output of your programs and how long each step takes.",
        "The files you create on VibeLearner.",
      ],
      "All of this is linked to your participant code, not to your name. VibeLearner sets one browser cookie to keep you connected to your session; it is not used for tracking.",
    ],
  },
  {
    heading: "Are there any risks?",
    blocks: [
      "The risks are minimal. You may feel frustrated or tired, as in any programming exercise, and you may wait for the AI to respond. You may take breaks, skip questions or stop at any time.",
      "The AI can make mistakes. VibeLearner runs your code to check its own answers, but please treat what it says with care.",
      "Anything you type into VibeLearner is recorded, so please do not type personal information such as your name, student number or email. If any personal information appears in the records, the researchers will remove it before analysis.",
    ],
  },
  {
    heading: "Are there any benefits?",
    blocks: [
      "You may not benefit directly. You will practise Python and practise reading, predicting and checking AI-generated code. The results may help make AI coding tools better for learning.",
    ],
  },
  {
    heading: "How will your privacy be protected?",
    blocks: [
      [
        "Your name is not stored with your study data, and no list linking names to participant codes is kept.",
        "The AI model runs on [CONFIRM: a UBC-managed computer]. Nothing you type is sent to outside AI companies.",
        "VibeLearner's records are stored on [CONFIRM: a UBC-managed computer] that only the research team can access. Quiz and survey answers are stored in UBC's Qualtrics account.",
        "Only Dr. Mohamed and Kaan can access the study data.",
        "At the end of data collection, all data are moved to encrypted UBC storage and deleted from VibeLearner and Qualtrics. They are kept for at least five years, then permanently deleted.",
        "Results are reported for groups of participants. Any short quotes of text or code will contain no personal information.",
      ],
    ],
  },
  {
    heading: "Will you be paid?",
    blocks: [
      "You will not be paid. You may enter a draw for one $25 gift card (for example, Amazon.ca) using a separate form at the end of the session. The form asks for your email address, which is kept apart from your study data and deleted after the draw. Your chance of winning is about 1 in 40, depending on how many people enter. The winner must answer a skill-testing question. You may enter the draw even if you don't finish the study. In the same form you can ask for a plain-language summary of the results.",
    ],
  },
  {
    heading: "What if you change your mind?",
    blocks: [
      "You may stop at any time during the session. Up to 14 days after your session, you can withdraw your data by emailing your participant code to Kaan or Dr. Mohamed. Your records, files and quiz and survey answers will then be deleted. After 14 days, your data will be part of the analysis and can no longer be removed. Because codes are not linked to names, we can find your data only through your code, so please keep it.",
    ],
  },
  {
    heading: "Who can you contact with questions?",
    blocks: [["Necmi Kaan Sapoglu: ka199967@student.ubc.ca", "Dr. Abdallah Mohamed: abdallah.mohamed@ubc.ca"]],
  },
  {
    heading: "Who can you contact with concerns or complaints?",
    blocks: [
      "If you have concerns or complaints about your rights as a research participant or your experience in this study, contact the Research Participant Complaint Line in the UBC Office of Research Ethics at 250-807-8832, toll-free at 1-877-822-8598, or RSIL@ors.ubc.ca. Please reference study number H25-02775.",
    ],
  },
  {
    heading: "Consent",
    blocks: [
      "Taking part in this study is entirely up to you. You may refuse to take part or withdraw at any time without giving a reason and without any effect on your grades or standing.",
      "By selecting \"I agree\" below, you confirm that you have read and understood this consent form, that you are at least 18 years old, and that you consent to take part in this study. Please download or print a copy of this page for your records.",
    ],
  },
];

export const AGREE = "I agree to take part in this study.";
export const DECLINE = "I do not agree to take part in this study.";
