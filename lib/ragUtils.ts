export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let index = 0; index < a.length; index++) {
    dotProduct += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}