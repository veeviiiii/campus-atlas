// Demo dataset from the "Campus Atlas" design: a made-up B.Tech CS semester with 13 topics,
// 6 sample papers (A-F) and demo prerequisite links. It is NOT a real college and is always
// labelled as sample data; it never appears on the Earth globe or in the campus list.

import type { Dataset, DQuestion, DTopic } from "./dataset";

const SUBJECTS = [
  { id: "OS", name: "Operating Systems", color: "#4268ff" },
  { id: "DBMS", name: "DBMS", color: "#7657ff" },
  { id: "ALG", name: "Algorithms", color: "#54e4ff" },
  { id: "NET", name: "Networks", color: "#ff786d" },
];
// Colour by how many of the 6 sample papers mention a topic.
const FREQ = ["#4268ff", "#4268ff", "#4268ff", "#54e4ff", "#ffc24a", "#ff786d", "#ff3b4e"];

// [name, subject, unit, papers (of 6), sample question, options, answer index]
const T: [string, string, number, number, string, string[], number][] = [
  ["Deadlocks", "OS", 3, 4, "Which is NOT a necessary condition for deadlock?", ["Mutual exclusion", "Hold and wait", "Preemption", "Circular wait"], 2],
  ["Paging", "OS", 4, 3, "Paging removes which problem of contiguous allocation?", ["External fragmentation", "Page faults", "Thrashing", "Caching"], 0],
  ["CPU Scheduling", "OS", 2, 5, "Which algorithm can cause starvation?", ["Round robin", "FCFS", "Priority scheduling", "None"], 2],
  ["Semaphores", "OS", 3, 2, "A binary semaphore behaves like a…", ["Queue", "Mutex lock", "Cache", "Stack"], 1],
  ["Normalization", "DBMS", 2, 6, "BCNF requires every determinant to be a…", ["Foreign key", "Candidate key", "Index", "Tuple"], 1],
  ["Transactions", "DBMS", 4, 4, 'The "I" in ACID stands for…', ["Integrity", "Isolation", "Indexing", "Inheritance"], 1],
  ["SQL Joins", "DBMS", 3, 5, "Which join keeps all rows from the left table?", ["Inner", "Left outer", "Cross", "Self"], 1],
  ["Indexing", "DBMS", 5, 2, "A B+ tree stores data records in…", ["Root only", "All nodes", "Leaf nodes", "Internal nodes"], 2],
  ["Dynamic Programming", "ALG", 2, 4, "DP is useful when subproblems…", ["Never repeat", "Overlap", "Are random", "Are infinite"], 1],
  ["Graph Traversal", "ALG", 4, 3, "BFS uses which data structure?", ["Stack", "Queue", "Heap", "Tree"], 1],
  ["Sorting", "ALG", 1, 5, "Worst-case time of quicksort is…", ["O(n log n)", "O(n)", "O(n²)", "O(log n)"], 2],
  ["TCP Congestion", "NET", 3, 3, "Slow start grows the window…", ["Linearly", "Exponentially", "Never", "Randomly"], 1],
  ["Subnetting", "NET", 1, 4, "A /26 mask leaves how many host bits (IPv4)?", ["4", "6", "8", "10"], 1],
];
const EDGES: [string, string][] = [
  ["Semaphores", "Deadlocks"],
  ["CPU Scheduling", "Semaphores"],
  ["Normalization", "SQL Joins"],
  ["SQL Joins", "Indexing"],
  ["Normalization", "Transactions"],
  ["Sorting", "Dynamic Programming"],
  ["Graph Traversal", "Dynamic Programming"],
  ["Subnetting", "TCP Congestion"],
];

const idOf = (name: string) => `demo-${T.findIndex((t) => t[0] === name)}`;

export function demoDataset(): Dataset {
  const questions: DQuestion[] = [];
  const topics: DTopic[] = T.map(([name, sub, unit, papers, q, options, answer], i) => {
    const question: DQuestion = {
      id: `demo-q${i}`,
      topicId: `demo-${i}`,
      text: q,
      exam: "sample",
      examName: "Sample papers A–F",
      marks: null,
      repeatOf: [],
      options,
      answer,
    };
    questions.push(question);
    return {
      id: `demo-${i}`,
      name,
      subjectId: sub,
      subjectIndex: SUBJECTS.findIndex((s) => s.id === sub),
      unitName: `Unit 0${unit}`,
      unitNo: unit,
      blindSpot: false,
      isRepeat: false,
      count: papers,
      marks: null,
      color: FREQ[papers],
      questions: [question],
      quiz: [{ q, options, answer, why: "" }],
    };
  });
  const prereqs = EDGES.map(([a, b]) => [idOf(a), idOf(b)] as [string, string]);
  const unlocks = (id: string) => prereqs.filter(([a]) => a === id).length;
  // The design's score: sample-paper mentions x 2 + topics unlocked x 1.5.
  const score = (t: DTopic) => t.count * 2 + unlocks(t.id) * 1.5;
  return {
    key: "demo/cs-sem5",
    real: false,
    label: "Demo University · sample data",
    context: "Demo University / B.Tech Computer Science (sample) / Semester 5 · sample data, not a real campus",
    honesty: "Sample dataset of 6 demo papers (A–F), written for the design. Not real past-paper records, and not a prediction.",
    exams: [],
    countNoun: "sample papers",
    countOf: 6,
    subjects: SUBJECTS,
    topics,
    byId: new Map(topics.map((t) => [t.id, t])),
    questions,
    rank: [...topics].sort((a, b) => score(b) - score(a)).map((t) => t.id),
    prereqs,
    priorityNote: "Priority score = sample-paper mentions × 2 + topics unlocked × 1.5, prerequisites first, studied topics skipped. Demo data.",
    legend: [
      { color: FREQ[2], label: "1–2 papers" },
      { color: FREQ[3], label: "3" },
      { color: FREQ[4], label: "4" },
      { color: FREQ[5], label: "5" },
      { color: FREQ[6], label: "6 of 6" },
    ],
  };
}
