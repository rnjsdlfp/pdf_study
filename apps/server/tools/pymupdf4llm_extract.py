#!/usr/bin/env python3
import argparse
import contextlib
import json
import sys
from pathlib import Path


def normalize_text(value):
    text = str(value or "")
    text = text.replace("\x00", "")
    text = "\n".join(line.rstrip() for line in text.splitlines())
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()


def as_page_number(metadata, fallback):
    for key in ("page", "page_number"):
        value = metadata.get(key)
        if isinstance(value, int) and value > 0:
            return value
        try:
            parsed = int(value)
            if parsed > 0:
                return parsed
        except Exception:
            pass
    return fallback


def emit(payload, status=0):
    print(json.dumps(payload, ensure_ascii=False))
    return status


def main():
    parser = argparse.ArgumentParser(description="Extract PDF text with PyMuPDF4LLM.")
    parser.add_argument("pdf_path")
    parser.add_argument("--force-ocr", action="store_true")
    parser.add_argument("--no-ocr", action="store_true")
    args = parser.parse_args()

    pdf_path = Path(args.pdf_path)
    if not pdf_path.is_file():
        return emit({"ok": False, "error": "missing_file", "message": f"PDF not found: {pdf_path}"}, 2)

    try:
        import pymupdf4llm
    except Exception as error:
        return emit(
            {
                "ok": False,
                "error": "missing_pymupdf4llm",
                "message": f"PyMuPDF4LLM is not installed: {error}",
            },
            2,
        )

    options = {"page_chunks": True}
    if args.force_ocr:
        options["force_ocr"] = True
    if args.no_ocr:
        options["use_ocr"] = False

    try:
        with contextlib.redirect_stdout(sys.stderr):
            chunks = pymupdf4llm.to_markdown(str(pdf_path), **options)
    except TypeError:
        # Older releases may not support the OCR kwargs.
        fallback_options = {"page_chunks": True}
        with contextlib.redirect_stdout(sys.stderr):
            chunks = pymupdf4llm.to_markdown(str(pdf_path), **fallback_options)
    except Exception as error:
        return emit({"ok": False, "error": "extract_failed", "message": str(error)}, 1)

    if isinstance(chunks, str):
        pages = [{"page_number": 1, "text": normalize_text(chunks)}]
        page_count = 1
    else:
        pages = []
        page_count = 0
        for index, chunk in enumerate(chunks or [], start=1):
            metadata = chunk.get("metadata", {}) if isinstance(chunk, dict) else {}
            page_number = as_page_number(metadata, index)
            text = normalize_text(chunk.get("text", "") if isinstance(chunk, dict) else chunk)
            pages.append({"page_number": page_number, "text": text})
            for key in ("page_count", "pages"):
                value = metadata.get(key)
                if isinstance(value, int):
                    page_count = max(page_count, value)
        page_count = max(page_count, len(pages), 1)
        pages.sort(key=lambda item: item["page_number"])

    return emit(
        {
            "ok": True,
            "extractor": "pymupdf4llm",
            "page_count": page_count,
            "pages": pages,
        }
    )


if __name__ == "__main__":
    raise SystemExit(main())
