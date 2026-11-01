"use client";

export function PrintButton({ label = "打印 / 另存 PDF" }: { label?: string }) {
  return (
    <button className="btn btn-sm" type="button" onClick={() => window.print()} title="使用浏览器打印，可选择另存为 PDF">
      {label}
    </button>
  );
}
