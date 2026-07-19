import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Button } from '@/components/Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('applies variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-danger');
  });

  it('respects disabled state', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('LandingPage', () => {
  it('renders create meeting button', async () => {
    vi.mock('@/services/api', () => ({
      createMeeting: vi.fn(),
    }));

    const { LandingPage } = await import('@/pages/LandingPage');

    render(
      <BrowserRouter>
        <LandingPage />
      </BrowserRouter>,
    );

    expect(screen.getByRole('button', { name: /create meeting/i })).toBeInTheDocument();
    expect(screen.getByText(/secure video meetings/i)).toBeInTheDocument();
  });
});

describe('DeviceSelect', () => {
  it('renders device options', async () => {
    const { DeviceSelect } = await import('@/components/DeviceSelect');

    const devices: MediaDeviceInfo[] = [
      { deviceId: 'cam1', kind: 'videoinput', label: 'Camera 1', groupId: 'g1', toJSON: () => ({}) },
    ];

    render(
      <DeviceSelect
        label="Camera"
        devices={devices}
        value="cam1"
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText('Camera')).toBeInTheDocument();
    expect(screen.getByText('Camera 1')).toBeInTheDocument();
  });
});
