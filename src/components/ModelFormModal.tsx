import { useEffect, useState } from 'react';
import type { ModelPreset } from '../lib/userSecrets';
import { newModelId } from '../lib/userSecrets';

export interface ModelFormModalProps {
  initial?: ModelPreset;
  onSave: (preset: ModelPreset) => void;
  onClose: () => void;
}

function argsToLines(args: string[]): string {
  return args.join('\n');
}

function linesToArgs(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export default function ModelFormModal({
  initial,
  onSave,
  onClose,
}: ModelFormModalProps) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [cli, setCli] = useState(initial?.cli ?? 'claude');
  const [argsText, setArgsText] = useState(
    initial ? argsToLines(initial.args) : '-p',
  );
  const [trackTokens, setTrackTokens] = useState(initial?.trackTokens ?? false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setLabel(initial.label);
      setCli(initial.cli);
      setArgsText(argsToLines(initial.args));
      setTrackTokens(!!initial.trackTokens);
    }
  }, [initial]);

  const previewArgs = linesToArgs(argsText);
  const preview = `${cli} ${previewArgs.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')} "<your prompt>"`;

  const save = () => {
    setError(null);
    if (!label.trim()) {
      setError('Label is required.');
      return;
    }
    if (!cli.trim()) {
      setError('CLI command is required.');
      return;
    }
    onSave({
      id: initial?.id ?? newModelId(),
      label: label.trim(),
      cli: cli.trim(),
      args: previewArgs,
      trackTokens,
    });
  };

  return (
    <div className="modal-shell" onClick={onClose}>
      <div className="modal-card model-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            {initial ? 'Edit model' : 'Add model'}
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="popover-hint">
            Define a CLI + arguments. When you pick this model in chat, we
            run <code>&lt;cli&gt; &lt;args…&gt; "&lt;your prompt&gt;"</code> on
            your laptop via the local agent. Your subscription pays for the
            LLM usage — not us.
          </div>
          <label>
            Label
            <span className="hint-text">
              What shows in the dropdown. e.g. "Claude Opus", "GPT-5", "Aider local".
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
              placeholder="Claude Opus"
            />
          </label>
          <label>
            CLI command
            <span className="hint-text">
              The executable the agent runs. Must be installed on your machine
              and on your PATH.
            </span>
            <input
              value={cli}
              onChange={(e) => setCli(e.target.value)}
              placeholder="claude"
            />
          </label>
          <label>
            Arguments
            <span className="hint-text">
              One per line. Do not include the prompt itself — we append it at
              the end for you.
            </span>
            <textarea
              className="env-textarea"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              spellCheck={false}
              rows={6}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={trackTokens}
              onChange={(e) => setTrackTokens(e.target.checked)}
            />
            <span>
              Track tokens & API-equivalent cost
              <span className="hint-text">
                Currently supported for <code>claude</code> only. Uses
                <code> --output-format stream-json</code> to capture input/output
                tokens and estimated API cost (your subscription is flat-rate;
                this is what you'd be paying on the API instead).
              </span>
            </span>
          </label>
          <label>
            Preview
            <code className="model-preview">{preview}</code>
          </label>
          {error && <div className="error-text">{error}</div>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            {initial ? 'Save changes' : 'Add model'}
          </button>
        </div>
      </div>
    </div>
  );
}
