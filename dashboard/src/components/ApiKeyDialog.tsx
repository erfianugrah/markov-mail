import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface ApiKeyDialogProps {
  onApiKeyChange: (apiKey: string) => void;
}

const STORAGE_KEY = 'fraud-detection-api-key';

export default function ApiKeyDialog({ onApiKeyChange }: ApiKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Check for saved API key on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedApiKey = localStorage.getItem(STORAGE_KEY);
      if (savedApiKey) {
        onApiKeyChange(savedApiKey);
      } else {
        setOpen(true);
      }
    }
  }, [onApiKeyChange]);

  const handleSubmit = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setError('Please enter an API key');
      return;
    }

    localStorage.setItem(STORAGE_KEY, trimmed);
    onApiKeyChange(trimmed);
    setOpen(false);
    setError(null);
    setApiKeyInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enter API Key</DialogTitle>
          <DialogDescription>
            Enter your admin API key to access the analytics dashboard. The key is stored locally in your browser.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="Enter your API key..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <Button onClick={handleSubmit} className="w-full">
            Submit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
