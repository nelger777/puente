import { Route, Routes } from "react-router";

// Screens arrive in milestone 4 (docs/SPEC.md §7).
export function App() {
  return (
    <Routes>
      <Route path="*" element={<main>Puente · Panel</main>} />
    </Routes>
  );
}
