import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();

const email = `From: "Amazon Rewards" <rewards@amaz0n-prizes.biz>
Subject: CONGRATULATIONS!!! You've WON a $1000 Gift Card

Dear Valued Customer,

You have been selected as our lucky winner! Click the link below within 24 hours
to claim your $1000 Amazon gift card. Just enter your credit card details to cover
the $1.99 shipping fee.

http://amaz0n-prizes.biz/claim?id=88231

Act NOW before this offer expires!`;

const result = await client.systemOne({
  state: email,
  questions: {
    isSpam: noul("Is this email spam or a phishing attempt?"),
    category: choice("What kind of email is this?", {
      phishing: "Tries to steal credentials or payment details",
      marketing: "Legitimate promotional email",
      personal: "Personal correspondence",
      transactional: "Receipt, order update, or account notice",
    }),
    riskScore: score("How risky is this email to the recipient?", [
      "Safe",
      "Low risk",
      "Medium risk",
      "High risk",
      "Dangerous",
    ]),
  },
});

console.log(JSON.stringify(result.answers, null, 2));
console.log("usage:", result.usage);
