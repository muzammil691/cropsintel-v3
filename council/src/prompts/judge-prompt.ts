import { JudgeInput } from '../providers/openai'

export function buildJudgePrompt(input: JudgeInput): string {
  const formatAnswer = (label: string, answer: string | null) =>
    `### ${label}\n${answer ?? '(no response)'}`

  return `Three AI experts have answered the same architectural question about the CropsIntel V3 project. Your job is to synthesize the BEST possible answer.

Where they agree, that's signal. Where they disagree, identify which one is most credible and why.

## Question
${input.question}

## Answers
${formatAnswer('Claude (Opus 4.7)', input.claudeAnswer)}

${formatAnswer('GPT-4o', input.gptAnswer)}

${formatAnswer('Gemini Pro', input.geminiAnswer)}

## Your task
Return a JSON object with exactly these fields:
{
  "synthesis": "<a single coherent, complete answer — the best synthesis of the three>",
  "confidence": <a number from 0.0 to 1.0 representing how confident the synthesis is — high if all three agree, lower if they conflict>,
  "reasoning": "<2 sentences: first sentence explains what the three had in common; second sentence explains any conflict and how you resolved it>"
}

Do NOT include any text outside the JSON object.`
}
