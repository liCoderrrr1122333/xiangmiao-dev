export interface DisplayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MainWindowBounds = DisplayWorkArea;

function boundedDimension(value: number) {
  return Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
}

export function resolveMainWindowBounds(workArea: DisplayWorkArea): MainWindowBounds {
  const workWidth = boundedDimension(workArea.width);
  const workHeight = boundedDimension(workArea.height);
  const margin = workWidth >= 3200 ? 32 : workWidth >= 1600 ? 20 : workWidth >= 1180 ? 12 : 0;
  const availableWidth = Math.max(1, workWidth - margin * 2);
  const availableHeight = Math.max(1, workHeight - margin * 2);
  const fillRatio = workWidth < 1600 ? 0.98 : 0.94;
  const width = Math.min(
    availableWidth,
    Math.max(Math.min(1280, availableWidth), Math.round(workWidth * fillRatio))
  );
  const height = Math.min(
    availableHeight,
    Math.max(Math.min(720, availableHeight), Math.round(workHeight * fillRatio))
  );

  return {
    x: Math.floor(workArea.x + (workWidth - width) / 2),
    y: Math.floor(workArea.y + (workHeight - height) / 2),
    width,
    height
  };
}
