// Links between pages. A pack key is "<college>/<course>-sem<N>", e.g. "davv-sdsf/mtech-aids-dual-sem1".

/** A course's page: pick the year and semester. */
export const programmeHref = (courseId: string) => `/course/${courseId}/`;
/** One semester of a course (one pack): its subjects. */
export const courseHref = (key: string) => `/c/${key}/`;
export const subjectHref = (key: string, subjectId: string) => `/c/${key}/${subjectId}/`;
export const topicHref = (key: string, subjectId: string, topicId: string) => `${subjectHref(key, subjectId)}#topic-${topicId}`;

/** "End_sem_pyq_sem1.pdf#p5" -> "/pages/<college>/End_sem_pyq_sem1_p5.jpg" (exported by the pipeline). */
export function pageImageUrl(collegeId: string, pageRef: string): string {
  const [file, page] = pageRef.split("#p");
  return `/pages/${collegeId}/${file.replace(/\.pdf$/i, "")}_p${page}.jpg`;
}

/** "End_sem_pyq_sem1.pdf#p5" -> "page 5". */
export function pageLabel(pageRef: string): string {
  return `page ${pageRef.split("#p")[1] ?? "?"}`;
}
