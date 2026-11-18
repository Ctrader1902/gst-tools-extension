"""Draw the extension icons (navy rounded square, white 'GST')."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "icons"
NAVY, WHITE = (20, 33, 61, 255), (255, 255, 255, 255)


def font(px: int):
    for name in ("segoeuib.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            continue
    return ImageFont.load_default()


def icon(size: int) -> Image.Image:
    scale = 4                                     # draw large, then downsample
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s // 5, fill=NAVY)
    text = "GST" if size >= 32 else "G"
    f = font(int(s * (0.36 if text == "GST" else 0.7)))
    box = d.textbbox((0, 0), text, font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((s - w) / 2 - box[0], (s - h) / 2 - box[1]), text, font=f, fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        icon(size).save(OUT / f"icon{size}.png")
        print(f"icons/icon{size}.png")
