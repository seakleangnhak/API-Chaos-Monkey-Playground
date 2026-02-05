/**
 * App Component
 * 
 * Main application layout with configuration, rules, and request log panels.
 */

import { ConfigPanel } from './components/ConfigPanel';
import { RulesPanel } from './components/RulesPanel';
import { RequestLog } from './components/RequestLog';

function App() {
    return (
        <div className="app-container">
            <header className="app-header">
                <h1>
                    <span className="emoji">🐵</span>
                    API Chaos Monkey Playground
                </h1>
                <a
                    href="http://localhost:3001/health"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--small"
                >
                    Check Server Health
                </a>
            </header>

            <main className="main-grid">
                <aside className="flex flex-col gap-md">
                    <ConfigPanel />
                    <RulesPanel />
                </aside>

                <section style={{ minHeight: '600px' }}>
                    <RequestLog />
                </section>
            </main>
        </div>
    );
}

export default App;
