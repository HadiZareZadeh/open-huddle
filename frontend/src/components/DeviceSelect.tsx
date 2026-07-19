interface DeviceSelectProps {
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
}

export function DeviceSelect({
  label,
  devices,
  value,
  onChange,
  disabled,
}: DeviceSelectProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-300">{label}</label>
      <select
        className="select-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || devices.length === 0}
        aria-label={label}
      >
        {devices.length === 0 ? (
          <option value="">No device found</option>
        ) : (
          devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `${label} ${device.deviceId.slice(0, 8)}`}
            </option>
          ))
        )}
      </select>
    </div>
  );
}
