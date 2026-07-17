# Project Overview

This is a `React + TypeScript + Vite` application named `pathway-demo`. It functions as a personal productivity or project management tool, allowing users to create and manage "roadmaps" (likely utilizing `reactflow` for node-based visualization), track daily tasks, view daily reports, and visualize activity with a heatmap. Data persistence is handled via `localStorage`. The project uses Tailwind CSS for styling and ESLint for code quality.

## Building and Running

*   **Start Development Server:** `npm run dev`
*   **Build Project:** `npm run build`
*   **Run Linter:** `npm run lint`
*   **Preview Build:** `npm run preview`

## Development Conventions

*   **Language:** TypeScript
*   **Framework:** React
*   **Build Tool:** Vite
*   **Styling:** Tailwind CSS (with `@tailwindcss/typography` plugin)
*   **State Management/Data Persistence:** Custom implementation utilizing browser `localStorage` (see `src/store.ts`).
*   **Linting:** ESLint is configured with recommended rules for JavaScript, TypeScript, React Hooks, and React Refresh.
*   **Component Structure:** Components are modularized and located within the `src/components` directory.
*   **Data Flow:** State management appears to primarily use React's `useState` and `useEffect` hooks, suggesting prop-drilling or context-like patterns for data flow.
*   **Naming Conventions:** PascalCase for React components and TypeScript interfaces, and camelCase for variables and functions.
