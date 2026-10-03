import type { Questions } from "../../src/ai/types.js";

export const SPAM_EMAIL = `From: "Amazon Rewards" <rewards@amaz0n-prizes.biz>
Subject: CONGRATULATIONS!!! You've WON a $1000 Gift Card

Dear Valued Customer,

You have been selected as our lucky winner! Click the link below within 24 hours
to claim your $1000 Amazon gift card. Just enter your credit card details to cover
the $1.99 shipping fee.

http://amaz0n-prizes.biz/claim?id=88231

Act NOW before this offer expires!`;

export const SPAM_QUESTIONS = {
  isSpam: {
    type: "boolean",
    instructions: "Is this email spam or a phishing attempt?",
  },
  category: {
    type: "choice",
    instructions: "What kind of email is this?",
    criteria: {
      phishing: "Tries to steal credentials or payment details",
      marketing: "Legitimate promotional email",
      personal: "Personal correspondence",
      transactional: "Receipt, order update, or account notice",
    },
  },
  riskScore: {
    type: "score",
    instructions: "How risky is this email to the recipient?",
    criteria: ["Safe", "Low risk", "Medium risk", "High risk", "Dangerous"],
  },
} as const satisfies Questions;

export const SPAM_WIRE_QUESTIONS = {
  isSpam: { type: "noul", instructions: SPAM_QUESTIONS.isSpam.instructions },
  category: {
    type: "choice",
    instructions: SPAM_QUESTIONS.category.instructions,
    criteria: SPAM_QUESTIONS.category.criteria,
  },
  riskScore: {
    type: "score",
    instructions: SPAM_QUESTIONS.riskScore.instructions,
    criteria: SPAM_QUESTIONS.riskScore.criteria,
  },
};
