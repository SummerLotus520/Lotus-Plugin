import sys
import ddddocr
import traceback

def solve_captcha(slider_path, background_path):
    try:
        det = ddddocr.DdddOcr(det=True, show_ad=False)
        
        with open(slider_path, 'rb') as f:
            slide_bytes = f.read()
        
        with open(background_path, 'rb') as f:
            target_bytes = f.read()
        
        res = det.slide_match(slide_bytes, target_bytes, simple_target=True)
        
        x_coordinate = res['target'][0]
        
        print(x_coordinate)
        sys.stdout.flush()

    except Exception as e:
        error_info = traceback.format_exc()
        print(f"Error in solve_slider.py: {error_info}", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: python solve_slider.py <slider_image_path> <background_image_path>", file=sys.stderr)
        sys.stderr.flush()
        sys.exit(1)
        
    slider_image_path = sys.argv[1]
    background_image_path = sys.argv[2]
    
    solve_captcha(slider_image_path, background_image_path)