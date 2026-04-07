import { cn } from '../../lib/utils';

type BannerProps = {
  tone: 'info' | 'error';
  message: string;
};

export function Banner({ tone, message }: BannerProps) {
  return (
    <div
      className={cn(
        'mb-4 rounded-sm border p-3',
        tone === 'error'
          ? 'border-[#d44a4a] bg-[rgba(140,43,43,0.2)] text-[#f2c4c4]'
          : 'border-[#4a8bd4] bg-[rgba(43,90,140,0.2)] text-[#d6e8ff]',
      )}
    >
      {message}
    </div>
  );
}
