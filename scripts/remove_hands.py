"""
Remove black gloved hands from microblading photos.
Direct approach: explicit region boxes + dark pixel detection + hull fill + inpaint.
No flood-fill (it fails when glove has specular highlights).
"""
import cv2
import numpy as np
import os

PUBLIC = os.path.join(os.path.dirname(__file__), '..', 'public')


def make_hand_mask(img, boxes, dark_threshold=155, close_px=80):
    """
    Within each box, detect dark pixels, close large gaps, fill convex hull.
    dark_threshold=155 catches the full glove including shiny/highlighted areas.
    """
    h, w = img.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)

    smooth = cv2.bilateralFilter(img, 9, 75, 75)
    L = cv2.cvtColor(smooth, cv2.COLOR_BGR2LAB)[:, :, 0]

    for (x1, y1, x2, y2) in boxes:
        # Region of interest
        roi_L = L[y1:y2, x1:x2]
        roi_dark = (roi_L < dark_threshold).astype(np.uint8) * 255

        # Large morphological close to fill specular highlight gaps
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px, close_px))
        roi_closed = cv2.morphologyEx(roi_dark, cv2.MORPH_CLOSE, k)

        # Convex hull of each large connected component
        contours, _ = cv2.findContours(roi_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        roi_hull = np.zeros_like(roi_closed)
        for cnt in contours:
            if cv2.contourArea(cnt) < 400:
                continue
            hull = cv2.convexHull(cnt)
            cv2.drawContours(roi_hull, [hull], -1, 255, cv2.FILLED)

        # Small dilation for edges
        k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (20, 20))
        roi_hull = cv2.dilate(roi_hull, k2, iterations=1)

        mask[y1:y2, x1:x2] = cv2.bitwise_or(mask[y1:y2, x1:x2], roi_hull)

    return mask


def inpaint_image(src_path, dst_path, mask, radius=50):
    img = cv2.imread(src_path)
    cv2.imwrite(dst_path.replace('.jpg', '_mask.jpg'), mask)
    result = cv2.inpaint(img, mask, inpaintRadius=radius, flags=cv2.INPAINT_TELEA)
    cv2.imwrite(dst_path, result, [cv2.IMWRITE_JPEG_QUALITY, 95])
    print(f"  Saved: {dst_path}")


# ── Image 1 (1716×1406) ────────────────────────────────────────────────────────
# Left glove: top-left corner, hand on forehead
# Right glove: fingers visible top-right near hair
print("Processing microblading-1.jpg ...")
img1 = cv2.imread(os.path.join(PUBLIC, 'microblading-1.jpg'))
mask1 = make_hand_mask(img1, boxes=[
    (0,   0,  430, 250),   # left hand (forehead area)
    (1020, 0, 1220, 360),  # right hand fingers
], dark_threshold=152, close_px=85)
inpaint_image(
    os.path.join(PUBLIC, 'microblading-1.jpg'),
    os.path.join(PUBLIC, 'microblading-1-clean.jpg'),
    mask1, radius=50,
)

# ── Image 2 (1715×1526) ────────────────────────────────────────────────────────
# Both gloved hands visible: left side (x<450, y<500), right side (x>1050, y<500)
# Instagram circle at bottom center
print("Processing microblading-2.jpg ...")
img2 = cv2.imread(os.path.join(PUBLIC, 'microblading-2.jpg'))
mask2 = make_hand_mask(img2, boxes=[
    (0,    0,  460, 520),  # left hand
    (1040, 0, 1715, 520),  # right hand
], dark_threshold=155, close_px=90)
# Add Instagram button
cv2.rectangle(mask2, (590, 1430), (770, 1526), 255, -1)
inpaint_image(
    os.path.join(PUBLIC, 'microblading-2.jpg'),
    os.path.join(PUBLIC, 'microblading-2-clean.jpg'),
    mask2, radius=50,
)

print("Done!")
