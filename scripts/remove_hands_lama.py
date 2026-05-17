"""
Remove black gloved hands using LaMa (Large Mask Inpainting) model.
LaMa is specifically designed for large-area removal — far better than TELEA.
First run downloads the model (~300MB).
"""
import os
os.environ['CUDA_VISIBLE_DEVICES'] = ''  # disable CUDA, force CPU on Mac

import torch
import cv2
import numpy as np
from PIL import Image
from simple_lama_inpainting import SimpleLama

PUBLIC = os.path.join(os.path.dirname(__file__), '..', 'public')

print("Loading LaMa model (downloads ~300MB on first run)...")
lama = SimpleLama(device=torch.device('cpu'))
print("Model ready.")


def make_hand_mask(img_bgr, boxes, dark_threshold=155, close_px=80):
    """Create solid mask for glove areas using dark pixel detection + convex hull."""
    h, w = img_bgr.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)

    smooth = cv2.bilateralFilter(img_bgr, 9, 75, 75)
    L = cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB)[:, :, 0]

    for (x1, y1, x2, y2) in boxes:
        roi_L = L[y1:y2, x1:x2]
        roi_dark = (roi_L < dark_threshold).astype(np.uint8) * 255

        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px, close_px))
        roi_closed = cv2.morphologyEx(roi_dark, cv2.MORPH_CLOSE, k)

        contours, _ = cv2.findContours(roi_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        roi_hull = np.zeros_like(roi_closed)
        for cnt in contours:
            if cv2.contourArea(cnt) < 400:
                continue
            hull = cv2.convexHull(cnt)
            cv2.drawContours(roi_hull, [hull], -1, 255, cv2.FILLED)

        k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (22, 22))
        roi_hull = cv2.dilate(roi_hull, k2, iterations=1)
        mask[y1:y2, x1:x2] = cv2.bitwise_or(mask[y1:y2, x1:x2], roi_hull)

    return mask


def process(src_path, dst_path, boxes, extra_rects=None, dark_threshold=155, close_px=80):
    img_bgr = cv2.imread(src_path)
    mask = make_hand_mask(img_bgr, boxes, dark_threshold, close_px)

    if extra_rects:
        for (x1, y1, x2, y2) in extra_rects:
            cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)

    # Save debug mask
    cv2.imwrite(dst_path.replace('.jpg', '_mask.jpg'), mask)

    # Convert to PIL for LaMa
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    img_pil = Image.fromarray(img_rgb)
    mask_pil = Image.fromarray(mask)

    print(f"  Running LaMa inpainting...")
    result_pil = lama(img_pil, mask_pil)

    result_pil.save(dst_path, quality=95)
    print(f"  Saved: {dst_path}")


# ── Image 1 (1716×1406) ────────────────────────────────────────────────────────
print("\nProcessing microblading-1.jpg ...")
process(
    src_path=os.path.join(PUBLIC, 'microblading-1.jpg'),
    dst_path=os.path.join(PUBLIC, 'microblading-1-clean.jpg'),
    boxes=[
        (0,    0,  440, 260),  # left glove on forehead
        (1020, 0, 1230, 370),  # right glove fingers
    ],
    dark_threshold=152, close_px=85,
)

# ── Image 2 (1715×1526) ────────────────────────────────────────────────────────
print("\nProcessing microblading-2.jpg ...")
process(
    src_path=os.path.join(PUBLIC, 'microblading-2.jpg'),
    dst_path=os.path.join(PUBLIC, 'microblading-2-clean.jpg'),
    boxes=[
        (0,    0,  470, 540),  # left glove (extends quite far down)
        (1040, 0, 1715, 540),  # right glove (extends quite far down)
    ],
    extra_rects=[(590, 1430, 770, 1526)],  # Instagram button
    dark_threshold=155, close_px=90,
)

print("\nAll done!")
