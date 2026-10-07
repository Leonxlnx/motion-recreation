"""RGB SSIM with the standard 7x7 window and sample covariance.

This uses float64 arithmetic and the same constants, reflected boundaries,
and three-pixel score crop as skimage.metrics.structural_similarity.
Overlapping row tiles bound memory usage for native-resolution comparisons.
"""
import cv2
import numpy as np

def rgb_ssim(reference, replica):
    if reference.shape != replica.shape or reference.ndim != 3 or reference.shape[2] != 3:
        raise ValueError('SSIM expects two equally sized RGB/BGR images.')
    if min(reference.shape[:2]) < 7:
        raise ValueError('SSIM requires at least 7 pixels in each dimension.')
    result = np.empty(reference.shape[:2], np.float64)
    def mean(values):
        return cv2.boxFilter(values, -1, (7, 7), normalize=True, borderType=cv2.BORDER_REFLECT)
    for first in range(0, len(reference), 128):
        last = min(first + 128, len(reference))
        lo, hi = max(0, first - 3), min(len(reference), last + 3)
        block = np.zeros((hi-lo, reference.shape[1]), np.float64)
        for channel in range(3):
            x = reference[lo:hi, :, channel].astype(np.float64)
            y = replica[lo:hi, :, channel].astype(np.float64)
            ux, uy = mean(x), mean(y)
            vx = (mean(x*x) - ux*ux) * (49/48)
            vy = (mean(y*y) - uy*uy) * (49/48)
            vxy = (mean(x*y) - ux*uy) * (49/48)
            block += ((2*ux*uy + 6.5025) * (2*vxy + 58.5225)) / ((ux*ux + uy*uy + 6.5025) * (vx+vy + 58.5225))
        result[first:last] = block[first-lo:last-lo] / 3
    return float(result[3:-3, 3:-3].mean()), result
