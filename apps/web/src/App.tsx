import { WorkbenchProvider } from './context/workbench-context';
import { AppShell } from './layout/app-shell';

export function App() {
  return (
    <WorkbenchProvider>
      <AppShell />
    </WorkbenchProvider>
  );
}
