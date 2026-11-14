#include <metal_stdlib>
using namespace metal;
float3 hsv(float hue, float s, float v) {
    float3 k=fmod(float3(5,3,1)+fract(hue+1)*6,6.0);
    return v*(1-s*clamp(min(k,4-k),0.0,1.0));
}
kernel void light(device const float4* points [[buffer(0)]], device const float* p [[buffer(1)]], device uchar* rgb [[buffer(2)]], uint i [[thread_position_in_grid]]) {
    if (i>=uint(p[10])) return;
    float3 point=points[i].xyz, sum=0;
    float t=p[0]*p[2], u=float(i)/max(1.0,p[10]-1), wave;
    for (uint l=0; l<uint(p[9]); l++) {
        uint j=16+l*4, kind=uint(p[j]); float gain=p[j+1], audio=p[j+2];
        float bass=min(1.0,p[5]*p[4])*audio, beat=p[6]*min(2.0,p[4])*audio;
        wave=.5+.5*sin(point.x*(3+p[3]*7)+point.y*2+point.z*3-t*1.2);
        float value=.45+wave*.4, hue=p[7]+wave*p[8];
        if (kind==1) { value=.12+.82*beat*(1-abs(u-.5)); hue=p[7]+u*p[8]; }
        if (kind==2) { value=.025+min(1.0,p[32+min(47u,uint(u*48))]*p[4]*2*audio); hue=p[7]+u*p[8]; }
        if (kind==3) { wave=.5+.5*sin(point.x*12+t*2+sin(point.y*8-t*3)); hue=.015+wave*.085; value=.25+wave*.65+bass*.1; }
        if (kind==4) { wave=.5+.5*sin(point.x*4+point.z*3-t+sin(point.y*4+t*.6)); hue=p[7]+wave*p[8]; value=.25+wave*.55+bass*.15; }
        float3 color=kind==5 ? float3(p[11],p[12],p[13])*p[1] : hsv(hue,.62+.18*wave,min(1.0,value*(.75+bass*.25))*p[1]);
        sum += color*gain;
    }
    sum=round(clamp(sum,0.0,1.0)*255);
    rgb[i*3]=uchar(sum.r); rgb[i*3+1]=uchar(sum.g); rgb[i*3+2]=uchar(sum.b);
}
